import type { MediaMetadata } from "../types/messages";
import { IMAGE_EXTS, VIDEO_EXTS } from "../constants/media";

const uriObjectPattern =
  /<URIObject[^>]*uri="https:\/\/api\.asm\.skype\.com\/v1\/objects\/([a-zA-Z0-9-]+)"/;
const picPattern = /[?&]pic=([a-zA-Z0-9-]+)/;
const filePattern = /[?&]file=([a-zA-Z0-9-]+)/;
// Teams format: <img src="https://experimental-api.asm.skype.com/v1/objects/{id}/views/imgo">
const teamsImgPattern =
  /<img[^>]*src="https:\/\/[^"]*\.asm\.skype\.com\/v1\/objects\/([a-zA-Z0-9-]+)/;
// Teams format: <video src="https://experimental-api.asm.skype.com/v1/objects/{id}/views/video">
const teamsVideoPattern =
  /<video[^>]*src="https:\/\/[^"]*\.asm\.skype\.com\/v1\/objects\/([a-zA-Z0-9-]+)/;

/**
 * Extracts the media ID from message content.
 * Handles different Skype and Teams media URL formats:
 * - URIObject: <URIObject uri="https://api.asm.skype.com/v1/objects/{id}">
 * - pic parameter: ?pic={id}
 * - file parameter: ?file={id}
 * - Teams img: <img src="https://experimental-api.asm.skype.com/v1/objects/{id}/views/imgo">
 * - Teams video: <video src="https://experimental-api.asm.skype.com/v1/objects/{id}/views/video">
 * Returns the first match found, or null if no media ID is present.
 */
export function extractMediaId(content: string): string | null {
  return (
    uriObjectPattern.exec(content)?.[1] ||
    picPattern.exec(content)?.[1] ||
    filePattern.exec(content)?.[1] ||
    teamsImgPattern.exec(content)?.[1] ||
    teamsVideoPattern.exec(content)?.[1] ||
    null
  );
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.substring(lastDot + 1).toLowerCase();
}

function isImageExtension(extension: string): boolean {
  return IMAGE_EXTS.has(extension.toLowerCase());
}

function isVideoExtension(extension: string): boolean {
  return VIDEO_EXTS.has(extension.toLowerCase());
}

async function getMediaMetadata(
  mediaId: string,
  mediaFiles: Map<string, File>,
): Promise<MediaMetadata | null> {
  const jsonFile = mediaFiles.get(`${mediaId}.json`);
  if (!jsonFile) return null;

  try {
    return JSON.parse(await jsonFile.text()) as MediaMetadata;
  } catch (error) {
    console.error("[mediaUtils] Failed to parse media metadata:", {
      error,
      mediaId,
      fileName: jsonFile.name,
    });
    return null;
  }
}

/**
 * Creates an object URL for a media file.
 * Handles file extension detection and alternative extensions (jpg/jpeg).
 * Works for both Skype (with metadata) and Teams (without metadata).
 */
export async function createMediaUrl(
  mediaId: string,
  mediaFiles: Map<string, File>,
): Promise<string | null> {
  try {
    const metadata = await getMediaMetadata(mediaId, mediaFiles);
    
    // If we have metadata (Skype), use the filename from it
    if (metadata) {
      const extension = getFileExtension(metadata.filename);
      if (extension) {
        const mediaFileName = `${mediaId}.1.${extension}`;
        let mediaFile = mediaFiles.get(mediaFileName);

        // Handle jpg/jpeg extension variations (Skype may store as either)
        if (!mediaFile && isImageExtension(extension)) {
          const altExt =
            extension === "jpg" ? "jpeg" : extension === "jpeg" ? "jpg" : null;
          if (altExt) {
            mediaFile = mediaFiles.get(`${mediaId}.1.${altExt}`);
          }
        }

        if (mediaFile) {
          return URL.createObjectURL(mediaFile);
        }
      }
    }

    // If no metadata (Teams) or file not found, try common extensions
    // Teams media files follow pattern: {mediaId}.1.{extension}
    const commonExtensions = ["jpeg", "jpg", "png", "gif", "mp4", "mov", "avi", "webm"];
    
    for (const ext of commonExtensions) {
      const mediaFile = mediaFiles.get(`${mediaId}.1.${ext}`);
      if (mediaFile) {
        return URL.createObjectURL(mediaFile);
      }
    }

    return null;
  } catch (error) {
    console.error("[mediaUtils] Failed to create media URL:", {
      error,
      mediaId,
    });
    return null;
  }
}

/**
 * Creates an object URL for a video thumbnail.
 * Video thumbnails follow pattern: {mediaId}.2.jpeg or {mediaId}.2.jpg
 * The ".2" indicates thumbnail variant (works for both Skype and Teams).
 */
export async function createVideoThumbnailUrl(
  mediaId: string,
  mediaFiles: Map<string, File>,
): Promise<string | null> {
  try {
    // Try jpeg first, then jpg
    let thumbnailFile = mediaFiles.get(`${mediaId}.2.jpeg`);
    if (!thumbnailFile) {
      thumbnailFile = mediaFiles.get(`${mediaId}.2.jpg`);
    }
    
    if (thumbnailFile) {
      return URL.createObjectURL(thumbnailFile);
    }

    return null;
  } catch (error) {
    console.error("[mediaUtils] Failed to create video thumbnail URL:", {
      error,
      mediaId,
    });
    return null;
  }
}

export async function getMediaType(
  mediaId: string,
  mediaFiles: Map<string, File>,
): Promise<"image" | "video" | null> {
  const metadata = await getMediaMetadata(mediaId, mediaFiles);
  
  // If we have metadata (Skype), use it
  if (metadata) {
    const extension = getFileExtension(metadata.filename);
    if (extension) {
      return isImageExtension(extension)
        ? "image"
        : isVideoExtension(extension)
          ? "video"
          : null;
    }
  }

  // If no metadata (Teams), check for actual files with common extensions
  const imageExtensions = ["jpeg", "jpg", "png", "gif"];
  const videoExtensions = ["mp4", "mov", "avi", "webm"];

  for (const ext of imageExtensions) {
    if (mediaFiles.has(`${mediaId}.1.${ext}`)) {
      return "image";
    }
  }

  for (const ext of videoExtensions) {
    if (mediaFiles.has(`${mediaId}.1.${ext}`)) {
      return "video";
    }
  }

  return null;
}
