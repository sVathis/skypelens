"""Tests for tools/skypelens_links.py. Run: python -m unittest discover tools"""

import json
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from skypelens_links import (
    DEFAULT_SKYPELENS_BASE_URL,
    add_skypelens_links,
    build_skypelens_url,
    finding_links_html,
    finding_links_markdown,
    resolve_conversation_id,
)

CONTRACT = json.loads(
    (Path(__file__).parent / "deep_link_contract.json").read_text(encoding="utf-8")
)


class BuildUrlTests(unittest.TestCase):
    def test_matches_shared_contract(self):
        self.assertEqual(CONTRACT["default_base_url"], DEFAULT_SKYPELENS_BASE_URL)
        for case in CONTRACT["cases"]:
            with self.subTest(case=case):
                url = build_skypelens_url(
                    case["conversation_id"], case["message_id"], case["base_url"]
                )
                self.assertEqual(url, case["url"])

    def test_round_trips_special_characters(self):
        for conv_id, msg_id in [
            ("8:live:.cid.abc", "1700000000000"),
            ("19:x.y_z@thread.skype", "a:b.c"),
            ("8:live:a+b c", "&=#?%/"),
        ]:
            with self.subTest(conv_id=conv_id, msg_id=msg_id):
                url = urlsplit(build_skypelens_url(conv_id, msg_id))
                self.assertEqual(url.query, "")
                params = parse_qs(url.fragment)
                self.assertEqual(params["conversationId"], [conv_id])
                self.assertEqual(params["messageId"], [msg_id])

    def test_rejects_invalid_input(self):
        with self.assertRaises(ValueError):
            build_skypelens_url("", "1")
        with self.assertRaises(ValueError):
            build_skypelens_url("8:live:a", "")
        with self.assertRaises(ValueError):
            build_skypelens_url("8:live:a", "1", "localhost:5173")

    def test_replaces_existing_link_parameters(self):
        url = build_skypelens_url("new", "2", "http://h/?conversationId=old&messageId=1&x=y#old")
        self.assertEqual(url, "http://h/?x=y#conversationId=new&messageId=2")


class ConversationIdTests(unittest.TestCase):
    def test_single_conversation_export(self):
        data = {"userId": "u", "conversations": [{"id": "8:live:a", "MessageList": [{}]}]}
        self.assertEqual(resolve_conversation_id(data), "8:live:a")

    def test_ignores_empty_conversations(self):
        data = {
            "conversations": [
                {"id": "empty", "MessageList": []},
                {"id": "8:live:a", "MessageList": [{}]},
            ]
        }
        self.assertEqual(resolve_conversation_id(data), "8:live:a")

    def test_multiple_conversations_need_explicit_id(self):
        data = {
            "conversations": [
                {"id": "a", "MessageList": [{}]},
                {"id": "b", "MessageList": [{}]},
            ]
        }
        with self.assertRaises(ValueError):
            resolve_conversation_id(data)
        self.assertEqual(resolve_conversation_id(data, explicit="b"), "b")

    def test_message_list_uses_conversationid_field(self):
        messages = [{"id": "1", "conversationid": "8:live:a"}, {"id": "2", "conversationid": "8:live:a"}]
        self.assertEqual(resolve_conversation_id(messages), "8:live:a")


class ReportLinkTests(unittest.TestCase):
    def finding(self):
        return {
            "message_key": "m0000123",
            "skype_id": "1700000000001",
            "source_index": 122,
            "quote": "synthetic quote <b>",
            "source_url": "history.html#m0000123",
        }

    def test_add_links_keeps_history_fallback(self):
        [finding] = add_skypelens_links([self.finding()], "8:live:a")
        self.assertEqual(
            finding["skypelens_url"],
            "http://localhost:5173/#conversationId=8%3Alive%3Aa&messageId=1700000000001",
        )
        self.assertEqual(finding["source_url"], "history.html#m0000123")
        self.assertNotIn("synthetic", finding["skypelens_url"])

    def test_missing_skype_id_gets_no_link(self):
        finding = self.finding()
        del finding["skype_id"]
        [finding] = add_skypelens_links([finding], "8:live:a")
        self.assertIsNone(finding["skypelens_url"])
        self.assertEqual(finding_links_markdown(finding), "[history.html](history.html#m0000123)")

    def test_html_links(self):
        [finding] = add_skypelens_links([self.finding()], "8:live:a", "https://x.github.io/skypelens/")
        rendered = finding_links_html(finding)
        self.assertIn(
            '<a class="skypelens-link" href="https://x.github.io/skypelens/#conversationId=8%3Alive%3Aa&amp;messageId=1700000000001" target="skypelens">View in SkypeLens</a>',
            rendered,
        )
        # Either would make the browser open a new tab per click instead of reusing one
        self.assertNotIn("noopener", rendered)
        self.assertNotIn("noreferrer", rendered)
        self.assertIn('<a class="history-link" href="history.html#m0000123">history.html</a>', rendered)

    def test_markdown_links(self):
        [finding] = add_skypelens_links([self.finding()], "8:live:a")
        self.assertEqual(
            finding_links_markdown(finding),
            "[View in SkypeLens](http://localhost:5173/#conversationId=8%3Alive%3Aa&messageId=1700000000001)"
            " · [history.html](history.html#m0000123)",
        )


if __name__ == "__main__":
    unittest.main()
