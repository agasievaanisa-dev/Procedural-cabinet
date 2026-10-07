import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';

const origins = new Set(['https://procedural-cabinet.onrender.com', 'http://localhost:4173', 'http://127.0.0.1:4173']);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers: Record<string,string> = {'Content-Type':'application/json','Vary':'Origin','Cache-Control':'no-store'};
  if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status,headers});
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return reply(405,{error:'Используйте POST'});
  if (origin && !origins.has(origin)) return reply(403,{error:'Нет доступа'});
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) return reply(401,{error:'Войдите в систему'});
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError} = await client.auth.getUser(bearer);
  if (authError || !auth.user) return reply(401,{error:'Сессия истекла'});
  const {data:actor,error:actorError} = await client.from('staff').select('id,role,active').eq('auth_user_id',auth.user.id).eq('active',true).maybeSingle();
  if (actorError || !actor || !['owner','admin'].includes(actor.role)) return reply(403,{error:'Доступно только владельцу'});
  try {
    const body = await req.json();
    if (body.action !== 'create_staff') return reply(400,{error:'Неизвестное действие'});
    const full_name = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!full_name || full_name.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400,{error:'Укажите имя и корректный email'});
    if (password.length < 12 || password.length > 128) return reply(400,{error:'Пароль должен содержать от 12 до 128 символов'});
    // Roles are assigned by the owner; this endpoint only creates nurses.
    const {data:created,error:createError} = await client.auth.admin.createUser({email,password,email_confirm:true});
    if (createError || !created.user) return reply(400,{error:createError?.message || 'Не удалось создать учётную запись'});
    const {data:staff,error:staffError} = await client.rpc('crm_admin_create_staff_v5',{p_actor:auth.user.id,p_auth_user:created.user.id,p_name:full_name});
    if (staffError) {
      await client.auth.admin.deleteUser(created.user.id);
      return reply(400,{error:'Не удалось сохранить сотрудника'});
    }
    return reply(201,{staff});
  } catch {
    return reply(400,{error:'Не удалось выполнить запрос'});
  }
});
