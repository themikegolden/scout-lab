import { createHash, randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

function clean(value, max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function categoryFor(text) {
  const v = text.toLowerCase();
  if (/payment|balance|payout|billing|invoice|charge/.test(v)) return 'PAYMENTS';
  if (/security|login|password|verification|alert/.test(v)) return 'SECURITY';
  if (/order|fulfill|shipment|shipping|customer/.test(v)) return 'ORDERS';
  if (/app|plugin|integration/.test(v)) return 'APP';
  if (/report|analytics|summary/.test(v)) return 'REPORT';
  return 'STORE';
}

function relevant(text) {
  return /(shopify|tough\s*stuff\s*gear|toughstuffgear|shopify balance|payment|payout|billing|invoice|order|store security|security alert|installed app|app alert|store report)/i.test(text);
}

function keyFor(record) {
  return createHash('sha256')
    .update([record.sender, record.subject, record.receivedAt].join('|'))
    .digest('hex');
}

export async function fetchLocalStoreMail({ user, appPassword, limit = 4 }) {
  if (!user || !appPassword) {
    const error = new Error('Local Gmail is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.local, restart Scout Lab, then press REFRESH EMAIL again.');
    error.code = 'LOCAL_GMAIL_NOT_CONFIGURED';
    throw error;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass: appPassword.replace(/\s+/g, '') },
    logger: false
  });

  const records = [];
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });

    const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const uids = await client.search({ since }, { uid: true });
    const recent = uids.slice(-60);
    if (!recent.length) return [];

    const range = recent.join(',');
    for await (const message of client.fetch(range, { envelope: true, source: true, internalDate: true, uid: true }, { uid: true })) {
      const parsed = await simpleParser(message.source);
      const sender = clean(parsed.from?.text || message.envelope?.from?.map((x) => x.address).join(', ') || 'Unknown sender', 350);
      const subject = clean(parsed.subject || message.envelope?.subject || 'No subject', 350);
      const text = clean(parsed.text || parsed.html || '', 5000);
      const haystack = [sender, subject, text].join(' ');
      if (!relevant(haystack)) continue;

      const receivedAt = (parsed.date || message.internalDate || new Date()).toISOString();
      const summaryBase = clean(text, 650);
      const summary = summaryBase || 'Store-related email found in Gmail.';
      records.push({
        gmailMessageId: message.uid ? `imap-uid-${message.uid}` : null,
        subject,
        sender,
        from: sender,
        summary,
        category: categoryFor(haystack),
        tag: categoryFor(haystack),
        receivedAt
      });
    }
  } finally {
    try { await client.logout(); } catch (_) {}
  }

  return records
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .slice(0, Math.max(1, Math.min(Number(limit) || 4, 4)));
}

export async function publishLocalMailSnapshot(db, records, requestedAt = new Date().toISOString()) {
  const now = new Date().toISOString();
  const runId = `run_local_mail_${randomUUID().replace(/-/g, '')}`;
  const researchedAt = now;

  await db.prepare(`INSERT INTO task_runs_v21
    (id,kind,trigger,source,status,requested_at,started_at,finished_at,checked_at,source_timestamp,records_checked,records_added,records_changed,summary,error,published_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      runId, 'mailroom', 'dashboard_button', 'local_gmail_imap', 'completed',
      requestedAt, now, now, now, researchedAt, records.length, records.length, 0,
      `Local Gmail refresh completed: ${records.length} relevant store email${records.length === 1 ? '' : 's'} loaded.`,
      null, now
    ).run();

  for (const record of records) {
    const messageKey = keyFor(record);
    await db.prepare(`INSERT INTO mail_messages
      (message_key,gmail_message_id,subject,sender,summary,category,received_at,source_timestamp,run_id,first_seen_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(message_key) DO UPDATE SET
        gmail_message_id=excluded.gmail_message_id,
        subject=excluded.subject,
        sender=excluded.sender,
        summary=excluded.summary,
        category=excluded.category,
        received_at=excluded.received_at,
        source_timestamp=excluded.source_timestamp,
        run_id=excluded.run_id,
        last_seen_at=excluded.last_seen_at`)
      .bind(
        messageKey, record.gmailMessageId, record.subject, record.sender, record.summary,
        record.category, record.receivedAt, researchedAt, runId, now, now
      ).run();
  }

  await db.prepare(`INSERT INTO feed_snapshots_v21
    (feed,run_id,source,source_timestamp,researched_at,published_at,checked_at,record_count,records_json,created_at)
    VALUES ('emails',?,?,?,?,?,?,?,?,?)`)
    .bind(runId, 'local_gmail_imap', researchedAt, researchedAt, now, now, records.length, JSON.stringify(records), now)
    .run();

  return {
    run: {
      id: runId,
      kind: 'mailroom',
      trigger: 'dashboard_button',
      source: 'local_gmail_imap',
      status: 'completed',
      requestedAt,
      startedAt: now,
      finishedAt: now,
      checkedAt: now,
      recordsChecked: records.length,
      recordsAdded: records.length,
      recordsChanged: 0,
      summary: `Loaded ${records.length} relevant store email${records.length === 1 ? '' : 's'} from local Gmail.`,
      error: null
    },
    records
  };
}
