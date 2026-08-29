/**
 * Mailpit REST API client for capturing emails sent by the local Supabase
 * Auth service during tests.
 *
 * Mailpit runs on http://localhost:54324 when `supabase start` is active.
 * API reference: https://mailpit.axllent.org/docs/api-v1/
 */

const MAILPIT_URL = process.env.MAILPIT_URL || 'http://localhost:54324';

interface MailpitRecipient {
  Address: string;
  Name: string;
}

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: MailpitRecipient[];
}

interface MailpitMessagesResponse {
  messages?: MailpitMessageSummary[];
  total?: number;
}

interface MailpitMessageDetail {
  Text: string;
  HTML: string;
}

/**
 * Poll Mailpit until an email addressed to `address` arrives, then return its
 * subject and plain-text body.
 *
 * @param address   Recipient email address (exact match on To field)
 * @param timeoutMs How long to wait before throwing (default 10 s)
 */
export async function getLatestEmailTo(
  address: string,
  timeoutMs = 10_000,
): Promise<{ subject: string; body: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=20`);
    if (!res.ok) {
      throw new Error(`Mailpit responded with status ${res.status}`);
    }

    const data = (await res.json()) as MailpitMessagesResponse;
    const msg = data.messages?.find((m) =>
      m.To.some((t) => t.Address === address),
    );

    if (msg) {
      const detail = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
      if (!detail.ok) {
        throw new Error(
          `Mailpit message detail responded with status ${detail.status}`,
        );
      }
      const detailData = (await detail.json()) as MailpitMessageDetail;
      return { subject: msg.Subject, body: detailData.Text };
    }

    await new Promise<void>((r) => setTimeout(r, 500));
  }

  throw new Error(`No email found for ${address} within ${timeoutMs}ms`);
}
