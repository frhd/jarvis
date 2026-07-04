import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { nanoid } from 'nanoid';
import { appConfig } from '../config';
import { MediaType } from '../types';
import fs from 'fs';
import path from 'path';

export class MediaService {
  constructor() {
    this.ensureMediaDirs();
  }

  async downloadMedia(
    client: TelegramClient,
    message: Api.Message
  ): Promise<{ mediaType: MediaType; mediaPath: string; mediaFileId: string } | null> {
    if (!message.media) {
      return null;
    }

    let mediaType: MediaType | null = null;
    let fileId: string | null = null;

    if (message.media instanceof Api.MessageMediaPhoto && message.media.photo) {
      mediaType = 'photo';
      if ('id' in message.media.photo) {
        fileId = message.media.photo.id.toString();
      }
    } else if (message.media instanceof Api.MessageMediaDocument && message.media.document) {
      const doc = message.media.document;
      if ('attributes' in doc && doc.attributes) {
        for (const attr of doc.attributes) {
          if (attr instanceof Api.DocumentAttributeAudio) {
            mediaType = attr.voice ? 'voice' : 'audio';
          } else if (attr instanceof Api.DocumentAttributeVideo) {
            mediaType = 'video';
          } else if (attr instanceof Api.DocumentAttributeSticker) {
            mediaType = 'sticker';
          }
        }
        if (!mediaType) {
          mediaType = 'document';
        }
      }
      if ('id' in doc) {
        fileId = doc.id.toString();
      }
    }

    if (!mediaType || !fileId) {
      return null;
    }

    const filename = `${nanoid()}.bin`;
    const mediaDir = this.getMediaDir(mediaType);
    const mediaPath = path.join(mediaDir, filename);

    const buffer = await client.downloadMedia(message.media, {});

    if (buffer) {
      fs.writeFileSync(mediaPath, buffer as Buffer);
    } else {
      return null;
    }

    return {
      mediaType,
      mediaPath,
      mediaFileId: fileId,
    };
  }

  getMediaDir(mediaType: MediaType): string {
    const { media } = appConfig;

    switch (mediaType) {
      case 'photo':
        return media.paths.photos;
      case 'document':
        return media.paths.documents;
      case 'voice':
        return media.paths.voice;
      case 'video':
        return media.paths.video;
      case 'audio':
        return media.paths.documents;
      case 'sticker':
        return media.paths.documents;
      default:
        return media.basePath;
    }
  }

  ensureMediaDirs(): void {
    const { media } = appConfig;

    const dirs = [
      media.basePath,
      media.paths.photos,
      media.paths.documents,
      media.paths.voice,
      media.paths.video,
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}
