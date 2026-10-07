import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed',{status:405});
  const token = req.headers.get('x-crm-backup-token');
  if (!token || token.length !== 64) return new Response('Unauthorized',{status:401});
  const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const authorized = await db.rpc('crm_backup_authorize_v5',{p_token:token});
  if (authorized.error || authorized.data !== true) return new Response('Unauthorized',{status:401});
  const body = await req.json().catch(()=>({}));
  const claim = await db.rpc('crm_backup_claim_v5',{p_force:body.force === true});
  if (claim.error) return new Response('Cannot start backup',{status:500});
  if (!claim.data) return Response.json({status:'already_started_or_completed'});
  const run = claim.data;
  let files = 0, bytes = 0;
  try {
    const snapshot = await db.rpc('crm_backup_data_v5');
    if (snapshot.error) throw new Error('Database snapshot failed');
    const tables = snapshot.data.tables;
    const sources = new Map<string,{bucket:string,path:string}>();
    for (const table of ['public.patient_files','public.patient_documents']) {
      for (const file of tables[table] || []) if (file.storage_path) sources.set('patient-documents/'+file.storage_path,{bucket:'patient-documents',path:file.storage_path});
    }
    for (const med of tables['public.medications'] || []) if (med.photo_path) sources.set('medication-photos/'+med.photo_path,{bucket:'medication-photos',path:med.photo_path});
    const manifest: Array<{bucket:string,path:string,backup_path:string,size:number,sha256:string}> = [];
    const sourceList = [...sources.values()];
    for (let offset=0;offset<sourceList.length;offset+=4) {
      await Promise.all(sourceList.slice(offset,offset+4).map(async ({bucket,path}) => {
        const source = await db.storage.from(bucket).download(path);
        if (source.error || !source.data) throw new Error('Document copy failed');
        const buffer = await source.data.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256',buffer);
        const sha256 = Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
        const backup_path = `${run.path}/objects/${bucket}/${path}`;
        const copied = await db.storage.from('crm-backups').upload(backup_path,buffer,{upsert:true,contentType:source.data.type || 'application/octet-stream'});
        if (copied.error) throw new Error('Backup storage write failed');
        manifest.push({bucket,path,backup_path,size:buffer.byteLength,sha256}); files++; bytes+=buffer.byteLength;
      }));
    }
    const data = new TextEncoder().encode(JSON.stringify({...snapshot.data,objects:manifest}));
    const digest = await crypto.subtle.digest('SHA-256',data);
    const sha256 = Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
    const uploaded = await db.storage.from('crm-backups').upload(`${run.path}/snapshot.json`,data,{upsert:true,contentType:'application/json'});
    if (uploaded.error) throw new Error('Snapshot upload failed');
    const marker = await db.storage.from('crm-backups').upload(`${run.path}/COMPLETE.json`,JSON.stringify({format:'crm-v5',created_at:new Date().toISOString(),files_count:files,sha256}),{upsert:true,contentType:'application/json'});
    if (marker.error) throw new Error('Backup completion marker failed');
    bytes+=data.byteLength;
    const finished = await db.rpc('crm_backup_finish_v5',{p_id:run.id,p_success:true,p_files:files,p_bytes:bytes,p_error:null});
    if (finished.error) throw new Error('Backup status update failed');
    // Remove complete/partial snapshot directories older than seven days.
    const cutoff = new Date(Date.now()+3*3600000-6*86400000).toISOString().slice(0,10);
    const dirs = await db.storage.from('crm-backups').list('',{limit:1000});
    const removePrefix = async (prefix:string) => {
      for (;;) {
        const listing = await db.storage.from('crm-backups').list(prefix,{limit:100,offset:0});
        if (listing.error) throw new Error('Retention listing failed');
        const entries=listing.data || [];
        const paths:string[]=[];
        for (const entry of entries) {
          if (entry.id) paths.push(`${prefix}/${entry.name}`);
          else await removePrefix(`${prefix}/${entry.name}`);
        }
        if (paths.length) {const deleted=await db.storage.from('crm-backups').remove(paths);if(deleted.error)throw new Error('Retention cleanup failed');}
        if(entries.length<100) break;
      }
    };
    for (const dir of dirs.data || []) if (/^\d{4}-\d{2}-\d{2}$/.test(dir.name) && dir.name<cutoff) await removePrefix(dir.name);
    return Response.json({status:'completed',files_count:files,bytes_count:bytes});
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Backup failed');
    await db.rpc('crm_backup_finish_v5',{p_id:run.id,p_success:false,p_files:files,p_bytes:bytes,p_error:'Не удалось завершить резервное копирование. Проверьте журнал функции.'});
    return Response.json({status:'failed'},{status:500});
  }
});
