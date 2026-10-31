import { Alert, Center, Code, Stack, Text } from "@mantine/core";
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
	const pendingDeepLink = useMessageStore((state) => state.pendingDeepLink);
	const navigationError = useMessageStore((state) => state.navigationError);
	const setNavigationError = useMessageStore((state) => state.setNavigationError);
	const { forwardedTarget } = useDeepLinkNavigation();

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
			{navigationError.message}
		</Alert>
	);

	if (!exportData) {
		const notice = forwardedTarget ? (
			<Alert icon={<IconExternalLink size={16} />} color="teal" title="Opened in your other SkypeLens tab">
				<Text size="sm">
					Another SkypeLens tab already has this export loaded and is now showing the linked message. Switch to that tab, or load the export below to view it here.
				</Text>
			</Alert>
		) : pendingDeepLink ? (
			<Alert icon={<IconLink size={16} />} color="blue" title="Load the export to open this link">
				<Stack gap={4}>
					<Text size="sm">
						This link points to {pendingDeepLink.messageId ? "a message in " : ""}conversation <Code>{pendingDeepLink.conversationId}</Code>. SkypeLens keeps nothing between visits, so load the Skype export that contains it and SkypeLens will jump straight there.
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
