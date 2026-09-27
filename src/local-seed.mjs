const BASELINE_AT = '2026-09-16T12:00:00.000Z';

const BASELINE_IG = [
  { handle:'@chattanoogabushcraft', name:'Chattanooga Bushcraft', tag:'BUSHCRAFT', followers:'9.9K', detail:'Bushcraft photography and field content.', productFit:'NomadRush Sling / pouches', profileUrl:'https://www.instagram.com/chattanoogabushcraft/' },
  { handle:'@packratbushcraft', name:'Richard Spicer / Pack Rat Bushcraft', tag:'BUSHCRAFT', followers:'16.4K', detail:'Outdoor education and bushcraft content.', productFit:'NomadRush Sling / pouches', profileUrl:'https://www.instagram.com/packratbushcraft/' },
  { handle:'@bushcraft.jack', name:'Jakub Kasprzak / Bushcraft Jack', tag:'BUSHCRAFT', followers:'18.2K', detail:'Modern bushcraft, packs, and outdoor gear.', productFit:'NomadRush Sling / pouches', profileUrl:'https://www.instagram.com/bushcraft.jack/' },
  { handle:'@primitivewanderer', name:'Alex Wander', tag:'OUTDOOR', followers:'64.3K', detail:'Field photography, knives, and outdoor gear.', productFit:'Pouches / product photography', profileUrl:'https://www.instagram.com/primitivewanderer/' },
  { handle:'@rod_hoare', name:'Rod Hoare Knife Images', tag:'PHOTOGRAPHY', followers:'6.8K', detail:'Knife and gear photography.', productFit:'Product photography / patches', profileUrl:'https://www.instagram.com/rod_hoare/' },
  { handle:'@thomsonknife', name:'Jason Thomson / Thomson Knife & Utility', tag:'KNIVES', followers:'7K', detail:'Outdoor knives and utility gear.', productFit:'Pouches / patches', profileUrl:'https://www.instagram.com/thomsonknife/' },
  { handle:'@luavafinland', name:'Luava', tag:'EDC', followers:'50.8K', detail:'Handmade leather EDC goods.', productFit:'EDC collaboration / pouches', profileUrl:'https://www.instagram.com/luavafinland/' },
  { handle:'@hammerandaxeleather', name:'Hammer and Axe Leather / Ara', tag:'EDC', followers:'10.8K', detail:'First-responder-focused wallets and leather EDC.', productFit:'Pouches / EDC collaboration', profileUrl:'https://www.instagram.com/hammerandaxeleather/' }
];

function normalizeHandle(value) {
  return String(value || '').replace(/^@/, '').toLowerCase();
}

function snapshotRecord(r) {
  return {
    handle:r.handle,
    name:r.name,
    tag:r.tag,
    detail:r.detail,
    note:'Imported baseline candidate from the previous Scout Lab. Reverify current activity and follower count before outreach.',
    sourceUrl:null,
    profileUrl:r.profileUrl,
    followers:r.followers,
    accountType:'creator',
    contactUrl:null,
    evidence:'Historical Scout Lab baseline; current status not yet reverified.',
    pipelineStage:'New',
    productFit:r.productFit,
    estimatedCollabCost:'',
    notes:'',
    firstSeenAt:BASELINE_AT,
    lastSeenAt:BASELINE_AT,
    sourceTimestamp:BASELINE_AT
  };
}

export async function seedLocalDatabase(db) {
  const countRow = await db.prepare('SELECT COUNT(*) AS count FROM ig_leads').first();
  if (Number(countRow?.count || 0) > 0) return { seeded:false, count:Number(countRow.count) };

  const now = new Date().toISOString();
  const records = BASELINE_IG.map(snapshotRecord);
  for (const r of records) {
    await db.prepare(`INSERT INTO ig_leads
      (normalized_handle,handle,name,tag,detail,note,source_url,profile_url,followers,account_type,contact_url,evidence,pipeline_stage,product_fit,estimated_collab_cost,notes,first_seen_at,last_seen_at,source_timestamp,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        normalizeHandle(r.handle), r.handle, r.name, r.tag, r.detail, r.note, r.sourceUrl, r.profileUrl, r.followers,
        r.accountType, r.contactUrl, r.evidence, r.pipelineStage, r.productFit, r.estimatedCollabCost, r.notes,
        r.firstSeenAt, r.lastSeenAt, r.sourceTimestamp, now
      ).run();
  }

  const runId = 'local_bootstrap_baseline';
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO task_runs_v21
      (id,kind,trigger,source,status,requested_at,started_at,finished_at,checked_at,source_timestamp,records_checked,records_added,records_changed,summary,error,published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(runId,'ig_scout','local_bootstrap','previous_scout_lab','completed',now,now,now,now,BASELINE_AT,records.length,records.length,0,'Imported the eight baseline IG candidates from the previous Scout Lab. Reverify before outreach.',null,now),
    db.prepare(`INSERT INTO feed_snapshots_v21
      (feed,run_id,source,source_timestamp,researched_at,published_at,checked_at,record_count,records_json,created_at)
      VALUES ('candidates',?,?,?,?,?,?,?,?,?)`)
      .bind(runId,'previous_scout_lab',BASELINE_AT,BASELINE_AT,now,now,records.length,JSON.stringify(records),now)
  ]);

  return { seeded:true, count:records.length };
}