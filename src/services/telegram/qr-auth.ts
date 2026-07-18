import { TelegramClient, Api } from 'telegram';
import input from 'input';
import qrcode from 'qrcode-terminal';
import { logger } from '../../utils/logger';

/**
 * Perform QR-code based authentication against Telegram.
 *
 * The caller supplies `onAuthenticated`, which is invoked once sign-in
 * succeeds (before the "authenticated" / session logging) so the owning
 * service can mark itself connected and start its monitoring tasks.
 */
export async function connectWithQR(deps: {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  onAuthenticated: (user: Api.User) => void;
}): Promise<void> {
  const { client, apiId, apiHash, onAuthenticated } = deps;

  logger.info('Starting QR code authentication...');
  logger.info('Open Telegram on your phone -> Settings -> Devices -> Link Desktop Device');
  logger.info('Then scan the QR code below:\n');

  try {
    await client.connect();

    const user = await client.signInUserWithQrCode(
      { apiId, apiHash },
      {
        qrCode: async (code) => {
          const url = `tg://login?token=${code.token.toString('base64url')}`;
          qrcode.generate(url, { small: true }, (qr: string) => {
            console.log('\n' + qr);
          });
          logger.info('Scan this QR code with your Telegram app...');
        },
        password: async () => {
          logger.info('2FA password required');
          return input.text('Enter your 2FA password: ');
        },
        onError: async (err) => {
          logger.error('QR auth error:', err.message);
          throw err;
        },
      }
    );

    onAuthenticated(user as Api.User);
    logger.info(`Successfully authenticated as ${(user as Api.User).firstName || 'User'}`);

    const session = client.session.save() as unknown as string;
    logger.info('\nIMPORTANT: Save this session string to SESSION_STRING in your .env:');
    logger.info(`SESSION_STRING="${session}"`);
    logger.info('');
  } catch (error) {
    logger.error('Failed to connect to Telegram:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
