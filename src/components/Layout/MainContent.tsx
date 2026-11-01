import { Alert, Button, Center, Code, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconExternalLink, IconLink } from "@tabler/icons-react";
import { useCallback } from "react";
import { FileUpload } from "../Upload/FileUpload";
import { useMessageStore, useExportData } from "../../store/messageStore";
import type { SkypeExport } from "../../types/messages";
import { MessageView } from "../Message/MessageView";
import { useDeepLinkNavigation } from "../../hooks/useDeepLinkNavigation";

export function MainContent() {
	const { setExportData } = useMessageStore();
	const exportData = useExportData();
	const requestedDeepLink = useMessageStore((state) => state.requestedDeepLink);
	const navigationError = useMessageStore((state) => state.navigationError);
	const setNavigationError = useMessageStore((state) => state.setNavigationError);
	const unloadExport = useMessageStore((state) => state.unloadExport);
	const { forwardedTarget, exportCopy } = useDeepLinkNavigation();

	const handleFileProcessed = useCallback((data: SkypeExport) => {
		setExportData(data);
	}, [setExportData]);

	const errorAlert = navigationError && (
		<Alert
			icon={<IconAlertCircle size={16} />}
			title="Could not open link"
			color="red"
			variant="light"
			radius={0}
			withCloseButton
			onClose={() => setNavigationError(null)}
			style={{ flexShrink: 0 }}
		>
			<Stack gap="xs" align="flex-start">
				<Text size="sm">{navigationError.message}</Text>
				{/* The link may come from a different export: load that one and the link completes */}
				{exportData && requestedDeepLink && navigationError.kind !== "invalid-link" && (
					<Button size="xs" variant="light" color="red" onClick={unloadExport}>
						Load another export
					</Button>
				)}
			</Stack>
		</Alert>
	);

	if (!exportData) {
		const notice = exportCopy === "copying" ? (
			<Alert icon={<Loader size={16} />} color="blue" title="Copying your export from your other SkypeLens tab…">
				<Text size="sm">
					Another SkypeLens tab already has this export loaded. This tab takes a copy, so the next report links open here without loading the export again. The copy stays in this browser.
				</Text>
			</Alert>
		) : exportCopy === "failed" ? (
			<Alert icon={<IconAlertCircle size={16} />} color="yellow" title="Could not copy the export from your other SkypeLens tab">
				<Text size="sm">
					Load the export below to open this link here.
				</Text>
			</Alert>
		) : forwardedTarget ? (
			<Alert icon={<IconExternalLink size={16} />} color="teal" title="Opened in your other SkypeLens tab">
				<Text size="sm">
					Another SkypeLens tab already has this export loaded and is now showing the linked message. Switch to that tab, or load the export below to view it here.
				</Text>
			</Alert>
		) : requestedDeepLink ? (
			<Alert icon={<IconLink size={16} />} color="blue" title="Load the export to open this link">
				<Stack gap={4}>
					<Text size="sm">
						This link points to {requestedDeepLink.messageId ? "a message in " : ""}conversation <Code>{requestedDeepLink.conversationId}</Code>. Load the Skype export that contains it and SkypeLens will jump straight there. Nothing is kept between visits, so the export has to be loaded in each new tab.
					</Text>
				</Stack>
			</Alert>
		) : null;

		return (
			<Center h="100%" style={{ overflow: "auto" }}>
				<Stack gap="md" py="md">
					{errorAlert}
					<FileUpload
						onFileProcessed={handleFileProcessed}
						notice={notice}
					/>
				</Stack>
			</Center>
		);
	}

	return (
		<Stack h="100%" gap={0} style={{ overflow: "auto" }}>
			{errorAlert}
			<MessageView />
		</Stack>
	);
}
