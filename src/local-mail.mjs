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


function extractRelayJson(text, runId) {
  const raw = String(text || '');
  const beginMarker = 'SCOUT_LAB_MAILROOM_JSON_BEGIN';
  const endMarker = 'SCOUT_LAB_MAILROOM_JSON_END';
  const start = raw.indexOf(beginMarker);
  const end = raw.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) return null;
  const jsonText = raw.slice(start + beginMarker.length, end).trim();
  let payload;
  try { payload = JSON.parse(jsonText); } catch (_) { return null; }
  if (!payload || String(payload.runId || '') !== String(runId || '')) return null;

  const records = Array.isArray(payload.records) ? payload.records : [];
  return {
    runId: String(payload.runId),
    researchedAt: payload.researchedAt || new Date().toISOString(),
    records: records.slice(0, 4).map((r) => ({
      gmailMessageId: clean(r.gmailMessageId, 255) || null,
      subject: clean(r.subject, 350),
      sender: clean(r.sender || r.from, 350),
      from: clean(r.sender || r.from, 350),
      summary: clean(r.summary, 1000),
      category: clean(r.category || r.tag, 80) || 'STORE',
      tag: clean(r.category || r.tag, 80) || 'STORE',
      receivedAt: new Date(r.receivedAt || Date.now()).toISOString()
    })).filter((r) => r.subject && r.sender && r.summary)
  };
}

export async function waitForChatGPTMailroomRelay({
  user,
  appPassword,
  runId,
  timeoutMs = 150000,
  pollMs = 3000
}) {
  if (!user || !appPassword) {
    const error = new Error('ChatGPT Mailroom relay needs GMAIL_USER and GMAIL_APP_PASSWORD in .env.local.');
    error.code = 'CHATGPT_MAILROOM_RELAY_NOT_CONFIGURED';
    throw error;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass: String(appPassword).replace(/\s+/g, '') },
    logger: false
  });

  const expectedSubject = 'SCOUT LAB MAILROOM RESULT ' + runId;
  const started = Date.now();
  const since = new Date(Date.now() - 20 * 60 * 1000);

  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });

    while (Date.now() - started < timeoutMs) {
      const uids = await client.search({ since }, { uid: true });
      const recent = uids.slice(-50);
      if (recent.length) {
        for await (const message of client.fetch(recent.join(','), {
          envelope: true,
          source: true,
          internalDate: true,
          uid: true
        }, { uid: true })) {
          const subject = clean(message.envelope?.subject || '', 500);
          if (subject !== expectedSubject) continue;

          const parsed = await simpleParser(message.source);
          const sender = clean(parsed.from?.text || '', 500).toLowerCase();
          if (sender && !sender.includes(String(user).toLowerCase())) continue;

          const payload = extractRelayJson(parsed.text || parsed.html || '', runId);
          if (payload) return payload;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    try { await client.logout(); } catch (_) {}
  }

  const error = new Error('ChatGPT finished without a Mailroom relay email reaching Gmail before the dashboard timeout.');
  error.code = 'CHATGPT_MAILROOM_RELAY_TIMEOUT';
  throw error;
}

export async function publishChatGPTMailroomRelay(db, payload) {
  const now = new Date().toISOString();
  const runId = clean(payload?.runId, 200);
  const researchedAt = new Date(payload?.researchedAt || now).toISOString();
  const records = Array.isArray(payload?.records) ? payload.records.slice(0, 4) : [];

  if (!runId) throw new Error('Mailroom relay is missing runId.');
  const existing = await db.prepare("SELECT id FROM task_runs_v21 WHERE id=? AND kind='mailroom' LIMIT 1").bind(runId).first();
  if (!existing) throw new Error('Mailroom relay does not match a pending Scout Lab run.');

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
        messageKey,
        record.gmailMessageId || null,
        record.subject,
        record.sender || record.from,
        record.summary,
        record.category || record.tag || 'STORE',
        record.receivedAt,
        researchedAt,
        runId,
        now,
        now
      ).run();
  }

  await db.batch([
    db.prepare(`INSERT INTO feed_snapshots_v21
      (feed,run_id,source,source_timestamp,researched_at,published_at,checked_at,record_count,records_json,created_at)
      VALUES ('emails',?,?,?,?,?,?,?,?,?)`)
      .bind(runId,'chatgpt_workspace_agent+gmail_relay',researchedAt,researchedAt,now,now,records.length,JSON.stringify(records),now),
    db.prepare(`UPDATE task_runs_v21 SET
      status='completed',
      source='chatgpt_workspace_agent+gmail_relay',
      source_timestamp=?,
      finished_at=?,
      checked_at=?,
      records_checked=?,
      records_added=?,
      records_changed=0,
      summary=?,
      error=NULL,
      publish_nonce_hash=NULL,
      publish_nonce_expires_at=NULL,
      published_at=?
      WHERE id=?`)
      .bind(
        researchedAt,
        now,
        now,
        records.length,
        records.length,
        'ChatGPT Gmail Mailroom refresh completed: ' + records.length + ' summarized email' + (records.length === 1 ? '' : 's') + ' received.',
        now,
        runId
      )
  ]);

  return { runId, recordsChecked: records.length, publishedAt: now };
}

export async function failChatGPTMailroomRelay(db, runId, error) {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE task_runs_v21
    SET status='failed',finished_at=?,checked_at=?,error=?
    WHERE id=? AND kind='mailroom' AND status IN ('queued','running')`)
    .bind(now,now,clean(error?.message || error || 'ChatGPT Mailroom relay failed.',1500),runId).run();
}
