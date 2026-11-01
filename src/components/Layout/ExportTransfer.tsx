import { Alert, Button, Code, Group, Loader, Modal, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconKey } from "@tabler/icons-react";
import { useEffect } from "react";
import type { ExportApprovalRequest } from "../../hooks/useDeepLinkNavigation";
import type { ExportCopyFailure, ExportCopyState } from "../../utils/tabBridge";

const FAILURE_TEXT: Record<ExportCopyFailure, string> = {
	declined: "The copy was declined in your other SkypeLens tab.",
	busy: "Your other SkypeLens tab is already answering another request. Try the link again.",
	error: "Your other SkypeLens tab could not copy its export (it may be too large for the browser's memory).",
	timeout: "Your other SkypeLens tab didn't answer in time.",
	unavailable: "Your other SkypeLens tab could not be reached. It may have been closed.",
};

/** Progress of copying an export from another tab, shown above the upload screen. */
export function ExportCopyNotice({ state }: { state: NonNullable<ExportCopyState> }) {
	if (state.phase === "awaiting-approval") {
		return (
			<Alert icon={<IconKey size={16} />} color="blue" title="Allow the copy in your other SkypeLens tab">
				<Stack gap="xs">
					<Text size="sm">
						Another SkypeLens tab already has this export loaded. Switch to it and allow it to copy the export here, so the next report links open in this tab without loading it again. Check that it shows this code:
					</Text>
					<Code fz="xl" fw={700} style={{ alignSelf: "flex-start" }} data-export-copy-code>
						{state.code}
					</Code>
					<Text size="xs" c="dimmed">The copy goes directly from that tab to this one, in this browser. Nothing is uploaded or saved. Or load the export below.</Text>
				</Stack>
			</Alert>
		);
	}
	if (state.phase === "copying") {
		return (
			<Alert icon={<Loader size={16} />} color="blue" title="Copying your export from your other SkypeLens tab…">
				<Text size="sm">Large exports take a few seconds.</Text>
			</Alert>
		);
	}
	return (
		<Alert icon={<IconAlertCircle size={16} />} color="yellow" title="Could not copy the export from your other SkypeLens tab">
			<Text size="sm">{FAILURE_TEXT[state.reason]} Load the export below to open this link here.</Text>
		</Alert>
	);
}

/** Asks whether to copy this tab's export to another SkypeLens tab. */
export function ExportApprovalDialog({ request }: { request: ExportApprovalRequest | null }) {
	// The question waits in this tab, which the user may not be looking at
	useEffect(() => {
		if (!request) return;
		const title = document.title;
		document.title = `(1) Allow copy? – ${title}`;
		return () => {
			document.title = title;
		};
	}, [request]);

	return (
		<Modal
			opened={request !== null}
			onClose={() => request?.respond(false)}
			title={<Title order={4}>Copy this export to another SkypeLens tab?</Title>}
			centered
		>
			{request && (
				<Stack gap="md">
					<Text size="sm">
						A SkypeLens tab is asking for a copy of the export loaded here, to open a link to conversation <Code>{request.target.conversationId}</Code>. That tab shows this code:
					</Text>
					<Code fz="xl" fw={700} style={{ alignSelf: "center" }} data-export-approval-code>
						{request.code}
					</Code>
					<Text size="sm">
						Allow only if you just clicked a SkypeLens link and the other tab shows the same code. The copy goes directly to that tab, in this browser; nothing is uploaded or saved.
					</Text>
					<Group justify="flex-end">
						<Button variant="default" onClick={() => request.respond(false)}>
							Don't allow
						</Button>
						<Button onClick={() => request.respond(true)}>Allow copy</Button>
					</Group>
				</Stack>
			)}
		</Modal>
	);
}
