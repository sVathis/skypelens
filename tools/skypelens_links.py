"""SkypeLens deep links for skype_analyze.py findings.

Builds links of the form

    <base>#conversationId=<Conversation.id>&messageId=<Message.id>

that open SkypeLens on the exact original message. Only identifiers go into the URL,
never message content or quotations. The links work independently of the order in
which the analysis pipeline extracted messages, because they use the original Skype
IDs rather than synthetic keys such as ``m0000123``.

report.html links open in one browser tab named ``skypelens``. The identifiers are in
the URL hash, so after the first click (where the export is loaded) every further
click only changes the hash of that tab: no reload, and no re-uploading the export.

Use it from skype_analyze.py (see "Deep Links and Message Permalinks" in README.md),
or run it standalone to add ``skypelens_url`` to an existing findings.json/findings.csv:

    python tools/skypelens_links.py --findings out/findings.json \\
        --conversation-json conversation.json [--base-url http://localhost:5173/]

Pure standard library; makes no network calls.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import os
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, MutableMapping, Optional
from urllib.parse import quote, unquote_plus, urlencode, urlsplit, urlunsplit

DEFAULT_SKYPELENS_BASE_URL = "http://localhost:5173/"
SKYPELENS_BASE_URL_ENV = "SKYPELENS_BASE_URL"
CONVERSATION_ID_PARAM = "conversationId"
MESSAGE_ID_PARAM = "messageId"
# Browser tab that all report links open in, so the loaded export is reused
SKYPELENS_WINDOW_NAME = "skypelens"


def build_skypelens_url(
    conversation_id: str,
    message_id: Optional[str] = None,
    base_url: str = DEFAULT_SKYPELENS_BASE_URL,
) -> str:
    """Return the canonical SkypeLens URL for a conversation, optionally at a message.

    The identifiers go in the URL hash. ``base_url`` may include a port, a sub-path
    (e.g. GitHub Pages) and unrelated query parameters, which are kept. Use exactly the
    address SkypeLens is opened at: links reuse an open SkypeLens tab without reloading
    only when everything before the ``#`` matches.
    """
    if not conversation_id:
        raise ValueError("conversation_id is required")
    if message_id == "":
        raise ValueError("message_id must not be empty")

    link = [(CONVERSATION_ID_PARAM, str(conversation_id))]
    if message_id is not None:
        link.append((MESSAGE_ID_PARAM, str(message_id)))
    # quote(safe="") percent-encodes ":", "@", "+", "/", "&", "=", "#" and spaces
    fragment = urlencode(link, quote_via=quote, safe="")
    return f"{normalize_base_url(base_url)}#{fragment}"


# Characters a browser percent-encodes when it parses a URL (WHATWG URL standard), in
# addition to controls, spaces and non-ASCII
_PATH_ENCODE_SET = '"#<>?`{}'
_QUERY_ENCODE_SET = "\"#<>'"
_DEFAULT_PORTS = {"http": 80, "https": 443}


def _percent_encode(text: str, encode_set: str) -> str:
    # Existing %XX escapes are kept as they are, as browsers do
    return "".join(
        ch if " " < ch < "\x7f" and ch not in encode_set else quote(ch, safe="")
        for ch in text
    )


def _is_link_param(query_part: str) -> bool:
    name = unquote_plus(query_part.split("=", 1)[0])
    return name in (CONVERSATION_ID_PARAM, MESSAGE_ID_PARAM)


def normalize_base_url(base_url: str) -> str:
    """Return ``base_url`` as SkypeLens' own URL would read in the browser, minus the hash.

    Mirrors ``getAppBaseUrl`` in src/utils/deepLink.ts: link parameters are dropped from
    the query and every other query parameter is kept byte for byte (``%20`` stays
    ``%20``). Like a browser, lower-cases the scheme and host, drops a default port and
    percent-encodes spaces and non-ASCII characters. Report links reuse an open SkypeLens
    tab without reloading only when this part matches that tab's URL exactly.
    """
    parts = urlsplit(base_url.strip())
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS or not parts.hostname:
        raise ValueError(f"base_url must be an absolute http(s) URL, got {base_url!r}")

    host = parts.hostname  # already lower-cased
    if ":" in host:
        host = f"[{host}]"  # IPv6
    port = parts.port  # raises ValueError for an invalid port
    if port is not None and port != _DEFAULT_PORTS[scheme]:
        host = f"{host}:{port}"
    userinfo, _, _ = parts.netloc.rpartition("@")
    netloc = f"{userinfo}@{host}" if userinfo else host

    path = _percent_encode(parts.path or "/", _PATH_ENCODE_SET)
    # Older links put the identifiers in the query; drop them from the base
    kept = [
        _percent_encode(part, _QUERY_ENCODE_SET)
        for part in parts.query.split("&")
        if part and not _is_link_param(part)
    ]
    query = "&".join(kept)
    return urlunsplit((scheme, netloc, path, query, ""))


def resolve_conversation_id(data: Any, explicit: Optional[str] = None) -> str:
    """Find the ``Conversation.id`` for the analysed conversation.

    Accepts a full Skype export or an extracted single-conversation JSON
    (``{"conversations": [{"id": ..., "MessageList": [...]}]}``), a bare conversation
    object (``{"id": ..., "MessageList": [...]}``) or a list of messages, whose
    ``conversationid`` field is used. ``explicit`` always wins.
    """
    if explicit:
        return explicit

    if isinstance(data, Mapping):
        conversations = data.get("conversations")
        if isinstance(conversations, list):
            with_messages = [c for c in conversations if c.get("MessageList")]
            candidates = with_messages or conversations
            if len(candidates) == 1 and candidates[0].get("id"):
                return str(candidates[0]["id"])
            ids = ", ".join(str(c.get("id")) for c in candidates[:10])
            raise ValueError(
                "The JSON contains several conversations; pass the one that was analysed "
                f"explicitly (e.g. --skypelens-conversation-id). Candidates: {ids}"
            )
        if data.get("id") and "MessageList" in data:
            return str(data["id"])
        messages = data.get("MessageList")
    else:
        messages = data

    if isinstance(messages, list):
        ids = {m.get("conversationid") for m in messages if isinstance(m, Mapping)}
        ids.discard(None)
        if len(ids) == 1:
            return str(ids.pop())

    raise ValueError("Could not determine the conversation ID from the JSON")


def add_skypelens_links(
    findings: Iterable[MutableMapping[str, Any]],
    conversation_id: Optional[str],
    base_url: str = DEFAULT_SKYPELENS_BASE_URL,
) -> list:
    """Add ``skypelens_url`` to each finding that has a ``skype_id``.

    A finding's own ``conversation_id`` (if present) overrides the default one.
    Existing fields, including ``source_url`` (history.html#message_key), are kept.
    """
    result = []
    for finding in findings:
        skype_id = finding.get("skype_id")
        conv_id = finding.get("conversation_id") or conversation_id
        has_id = skype_id is not None and str(skype_id) != ""
        finding["skypelens_url"] = (
            build_skypelens_url(str(conv_id), str(skype_id), base_url)
            if has_id and conv_id
            else None
        )
        result.append(finding)
    return result


def history_href(finding: Mapping[str, Any]) -> Optional[str]:
    """The existing local fallback link: ``source_url`` or ``history.html#<message_key>``."""
    if finding.get("source_url"):
        return str(finding["source_url"])
    if finding.get("message_key"):
        return f"history.html#{finding['message_key']}"
    return None


def finding_links_html(finding: Mapping[str, Any]) -> str:
    """HTML for report.html: "View in SkypeLens" plus the history.html fallback.

    All SkypeLens links target the same named tab. No rel="noopener"/"noreferrer":
    either would make the browser forget that tab and open a new one per click. The
    tradeoff is that the SkypeLens page gets ``window.opener`` and could redirect the
    report's tab, so use a base URL you trust (your own SkypeLens).
    """
    links = []
    if finding.get("skypelens_url"):
        links.append(
            '<a class="skypelens-link" href="{}" target="{}">View in SkypeLens</a>'.format(
                html.escape(str(finding["skypelens_url"]), quote=True),
                SKYPELENS_WINDOW_NAME,
            )
        )
    fallback = history_href(finding)
    if fallback:
        links.append(
            '<a class="history-link" href="{}">history.html</a>'.format(
                html.escape(fallback, quote=True)
            )
        )
    return " · ".join(links)


def finding_links_markdown(finding: Mapping[str, Any]) -> str:
    """Markdown for report.md: "View in SkypeLens" plus the history.html fallback."""
    # The URL is fully percent-encoded (no spaces or parentheses), so it is safe
    # as a plain Markdown link destination.
    links = []
    if finding.get("skypelens_url"):
        links.append(f"[View in SkypeLens]({finding['skypelens_url']})")
    fallback = history_href(finding)
    if fallback:
        links.append(f"[history.html]({fallback})")
    return " · ".join(links)


def default_base_url() -> str:
    return os.environ.get(SKYPELENS_BASE_URL_ENV) or DEFAULT_SKYPELENS_BASE_URL


def add_cli_arguments(parser: argparse.ArgumentParser) -> None:
    """Register --skypelens-base-url and --skypelens-conversation-id on a parser."""
    parser.add_argument(
        "--skypelens-base-url",
        default=default_base_url(),
        help=(
            "SkypeLens URL used for 'View in SkypeLens' links "
            f"(default: ${SKYPELENS_BASE_URL_ENV} or {DEFAULT_SKYPELENS_BASE_URL})"
        ),
    )
    parser.add_argument(
        "--skypelens-conversation-id",
        default=None,
        help="Conversation.id to link to when the input JSON holds several conversations",
    )


def _annotate_csv(path: Path, findings: list) -> None:
    urls_by_key = {
        (str(f.get("message_key")), str(f.get("skype_id"))): f.get("skypelens_url")
        for f in findings
    }
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    if "skypelens_url" not in fieldnames:
        fieldnames.append("skypelens_url")
    for row in rows:
        key = (str(row.get("message_key")), str(row.get("skype_id")))
        row["skypelens_url"] = urls_by_key.get(key) or ""
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Add SkypeLens deep links (skypelens_url) to existing findings files."
    )
    parser.add_argument("--findings", required=True, type=Path, help="findings.json to update in place")
    parser.add_argument("--csv", type=Path, help="findings.csv to update in place (optional)")
    parser.add_argument(
        "--conversation-json",
        type=Path,
        help="The conversation JSON that was analysed (used to read Conversation.id)",
    )
    add_cli_arguments(parser)
    args = parser.parse_args(argv)

    conversation_id = args.skypelens_conversation_id
    if not conversation_id:
        if not args.conversation_json:
            parser.error("pass --conversation-json or --skypelens-conversation-id")
        with args.conversation_json.open(encoding="utf-8") as handle:
            conversation_id = resolve_conversation_id(json.load(handle))

    with args.findings.open(encoding="utf-8") as handle:
        data = json.load(handle)
    findings = data.get("findings", []) if isinstance(data, dict) else data
    add_skypelens_links(findings, conversation_id, args.skypelens_base_url)
    with args.findings.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    if args.csv:
        _annotate_csv(args.csv, findings)

    linked = sum(1 for f in findings if f.get("skypelens_url"))
    print(f"Added SkypeLens links to {linked}/{len(findings)} findings", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
