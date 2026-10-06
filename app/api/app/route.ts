import { env } from "cloudflare:workers";
import { cookies, headers } from "next/headers";

export const dynamic = "force-dynamic";
const DB = () => { if (!env.DB) throw new Error("Banco de dados indisponível"); return env.DB; };
const roles = ["CEO", "TI", "Gerente de vendas", "Corretor", "Assistente", "Analista financeiro", "Marketing", "Fotógrafo/filmmaker"];
const permissions: Record<string, string[]> = {
  CEO: ["users", "properties", "deals", "payments", "contacts", "social"],
  TI: ["users", "properties"],
  "Gerente de vendas": ["properties", "deals", "payments", "contacts"],
  Corretor: ["properties", "deals", "contacts"],
  Assistente: ["properties", "contacts"],
  "Analista financeiro": ["properties", "deals", "payments"],
  Marketing: ["properties", "social"],
  "Fotógrafo/filmmaker": ["properties"],
};
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const validCPF = (value: string) => {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let length = 9; length <= 10; length++) {
    const sum = value.slice(0,length).split("").reduce((total,digit,index) => total + Number(digit) * (length + 1 - index), 0);
    if (((sum * 10) % 11) % 10 !== Number(value[length])) return false;
  }
  return true;
};
const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const now = () => new Date().toISOString();
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes).map(x => x.toString(16).padStart(2,"0")).join("");
const sha = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
const hashPassword = async (password: string, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 180000 }, key, 256);
  return `${salt}:${hex(new Uint8Array(bits))}`;
};
const verifyPassword = async (password: string, stored: string) => {
  const salt = stored.split(":")[0];
  if (!salt || !stored.includes(":")) return false;
  const computed = await hashPassword(password, salt);
  const a = enc.encode(computed), b = enc.encode(stored);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a[i] ^ b[i];
  return diff === 0;
};
async function currentUser() {
  const token = (await cookies()).get("mgl_session")?.value;
  if (!token) return null;
  const id = await sha(token);
  const row = await DB().prepare(`SELECT u.id,u.cpf,u.name,u.email,u.phone,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.active=1`).bind(id,now()).first<Record<string, unknown>>();
  return row;
}
async function createSession(userId: number) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await DB().prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(await sha(token),userId,new Date(Date.now()+7*86400000).toISOString()).run();
  (await cookies()).set("mgl_session", token, { httpOnly:true, secure:true, sameSite:"lax", path:"/", maxAge:7*86400 });
}
function allowed(user: Record<string, unknown>, area: string) { return permissions[String(user.role)]?.includes(area); }
async function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = (await headers()).get("host");
  return !origin || (host && new URL(origin).host === host);
}
async function listData(user: Record<string, unknown>) {
  const result: Record<string, unknown> = { user, permissions: permissions[String(user.role)] ?? [] };
  if (allowed(user,"properties")) result.properties = (await DB().prepare("SELECT p.*,u.name broker_name FROM properties p LEFT JOIN users u ON u.id=p.broker_id ORDER BY p.id DESC").all()).results;
  if (allowed(user,"deals")) {
    const sql = `SELECT d.*,p.title property_title,u.name broker_name FROM deals d JOIN properties p ON p.id=d.property_id JOIN users u ON u.id=d.broker_id ${user.role === "Corretor" ? "WHERE d.broker_id=?" : ""} ORDER BY d.id DESC`;
    result.deals = (await (user.role === "Corretor" ? DB().prepare(sql).bind(user.id) : DB().prepare(sql)).all()).results;
  }
  if (allowed(user,"payments")) result.payments = (await DB().prepare("SELECT py.*,d.client_name,p.title property_title FROM payments py JOIN deals d ON d.id=py.deal_id JOIN properties p ON p.id=d.property_id ORDER BY py.id DESC").all()).results;
  if (allowed(user,"contacts")) result.contacts = (await DB().prepare("SELECT * FROM owner_contacts ORDER BY id DESC").all()).results;
  if (allowed(user,"social")) result.social = (await DB().prepare("SELECT * FROM social_links ORDER BY id DESC").all()).results;
  if (["CEO","Gerente de vendas"].includes(String(user.role))) result.brokers = (await DB().prepare("SELECT id,name,role FROM users WHERE active=1 AND role IN ('Corretor','Gerente de vendas','CEO') ORDER BY name").all()).results;
  if (allowed(user,"users")) result.users = (await DB().prepare("SELECT id,cpf,name,email,phone,role,active,created_at FROM users ORDER BY id DESC").all()).results;
  return result;
}
export async function GET() {
  try {
    const count = await DB().prepare("SELECT COUNT(*) n FROM users").first<{n:number}>();
    if (!count?.n) return Response.json({ setup: true });
    const user = await currentUser();
    if (!user) return Response.json({ login: true });
    return Response.json(await listData(user));
  } catch (e) { console.error("MGL GET", e); return err("Sistema temporariamente indisponível.",500); }
}
export async function POST(request: Request) {
  try {
    if (!await sameOrigin(request)) return err("Origem inválida.",403);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action,40);
    if (action === "owner-contact") {
      const name=clean(body.name,100), phone=digits(body.phone), email=clean(body.email,150), city=clean(body.city,100), message=clean(body.message,1000);
      if (!name || phone.length<10 || !email.includes("@") || !city || !message) return err("Preencha todos os campos de contato.");
      await DB().prepare("INSERT INTO owner_contacts (name,phone,email,city,message,status,created_at) VALUES (?,?,?,?,?,'novo',?)").bind(name,phone,email,city,message,now()).run();
      return Response.json({ ok:true });
    }
    if (action === "setup") {
      const platformEmail = (await headers()).get("oai-authenticated-user-email");
      if (!platformEmail) return err("A configuração inicial requer acesso do proprietário ao Site privado.",403);
      const cpf=digits(body.cpf), name=clean(body.name,100), email=clean(body.email,150).toLowerCase(), phone=digits(body.phone), password=String(body.password??"");
      if (!validCPF(cpf) || !name || !email.includes("@") || phone.length<10 || password.length<12) return err("Informe CPF válido, nome, e-mail, telefone e senha de pelo menos 12 caracteres.");
      const hash=await hashPassword(password);
      const result=await DB().prepare("INSERT INTO users (cpf,name,email,phone,role,password_hash,active,created_at) SELECT ?,?,?,?,'CEO',?,1,? WHERE NOT EXISTS (SELECT 1 FROM users)").bind(cpf,name,email,phone,hash,now()).run();
      if (!result.meta.changes) return err("O administrador já foi configurado.",409);
      await DB().batch([
        DB().prepare("INSERT INTO properties (title,city,state,neighborhood,type,price,area,bedrooms,parking,description,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'disponivel',?)").bind("Penthouse Atlântico","Rio de Janeiro","RJ","Leblon","venda",12800000,346,4,4,"Cobertura de referência para apresentar a vitrine MGL. Dados ilustrativos.",now()),
        DB().prepare("INSERT INTO properties (title,city,state,neighborhood,type,price,area,bedrooms,parking,description,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'disponivel',?)").bind("Residência Jardim Europa","São Paulo","SP","Jardim Europa","aluguel",42000,280,3,3,"Imóvel de referência para apresentar a vitrine MGL. Dados ilustrativos.",now()),
        DB().prepare("INSERT INTO properties (title,city,state,neighborhood,type,price,area,bedrooms,parking,description,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'disponivel',?)").bind("Vista do Lago","Brasília","DF","Lago Sul","venda",6900000,315,4,4,"Imóvel de referência para apresentar a vitrine MGL. Dados ilustrativos.",now()),
      ]);
      await createSession(Number(result.meta.last_row_id));
      return Response.json({ ok:true });
    }
    if (action === "login") {
      const cpf=digits(body.cpf), password=String(body.password??"");
      if (!validCPF(cpf)) return err("CPF ou senha inválidos.",401);
      const ip=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")||"unknown";
      const attemptKey=await sha(`${cpf}:${ip}`);
      const previous=await DB().prepare("SELECT count,last_at FROM login_attempts WHERE key=?").bind(attemptKey).first<{count:number,last_at:string}>();
      if (previous && previous.count>=5 && Date.now()-Date.parse(previous.last_at)<15*60000) return err("Muitas tentativas. Aguarde 15 minutos.",429);
      const row=await DB().prepare("SELECT id,password_hash FROM users WHERE cpf=? AND active=1").bind(cpf).first<{id:number,password_hash:string}>();
      if (!row || !await verifyPassword(password,row.password_hash)) {
        const count=previous && Date.now()-Date.parse(previous.last_at)<15*60000?previous.count+1:1;
        await DB().prepare("INSERT INTO login_attempts (key,count,last_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,last_at=excluded.last_at").bind(attemptKey,count,now()).run();
        return err("CPF ou senha inválidos.",401);
      }
      await DB().prepare("DELETE FROM login_attempts WHERE key=?").bind(attemptKey).run();
      await createSession(row.id);
      return Response.json({ ok:true });
    }
    if (action === "logout") {
      const token=(await cookies()).get("mgl_session")?.value;
      if (token) await DB().prepare("DELETE FROM sessions WHERE id=?").bind(await sha(token)).run();
      (await cookies()).delete("mgl_session");
      return Response.json({ ok:true });
    }
    const user=await currentUser(); if (!user) return err("Faça login para continuar.",401);
    const area=action.split("-")[0]; if (!allowed(user,area)) return err("Sem permissão para esta ação.",403);
    if (action === "properties-create") {
      if (!["CEO","TI","Gerente de vendas","Assistente"].includes(String(user.role))) return err("Sem permissão.",403);
      const title=clean(body.title,120),city=clean(body.city,100),state=clean(body.state,2).toUpperCase(),neighborhood=clean(body.neighborhood,100),type=clean(body.type,20),description=clean(body.description,1500),imageUrl=clean(body.imageUrl,500);
      const price=Number(body.price),areaM=Number(body.area),bedrooms=Number(body.bedrooms),parking=Number(body.parking);
      if (!title||!city||state.length!==2||!neighborhood||!["venda","aluguel"].includes(type)||!Number.isInteger(price)||price<=0||!Number.isInteger(areaM)||areaM<=0||!Number.isInteger(bedrooms)||bedrooms<0||!Number.isInteger(parking)||parking<0) return err("Confira os dados do imóvel.");
      if (imageUrl && !/^https:\/\//i.test(imageUrl)) return err("A imagem deve usar HTTPS.");
      await DB().prepare("INSERT INTO properties (title,city,state,neighborhood,type,price,area,bedrooms,parking,description,image_url,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'disponivel',?)").bind(title,city,state,neighborhood,type,price,areaM,bedrooms,parking,description,imageUrl||null,now()).run();
    } else if (action === "properties-status") {
      if (!["CEO","TI","Gerente de vendas","Assistente"].includes(String(user.role))) return err("Sem permissão.",403);
      const status=clean(body.status,20); if (!["disponivel","reservado","vendido","alugado"].includes(status)) return err("Status inválido.");
      await DB().prepare("UPDATE properties SET status=? WHERE id=?").bind(status,Number(body.id)).run();
    } else if (action === "properties-image") {
      if (!["CEO","Gerente de vendas","Marketing","Fotógrafo/filmmaker"].includes(String(user.role))) return err("Sem permissão.",403);
      const imageUrl=clean(body.imageUrl,500);
      try { if (new URL(imageUrl).protocol!=="https:") throw new Error(); } catch { return err("Informe uma URL HTTPS válida para a foto."); }
      await DB().prepare("UPDATE properties SET image_url=? WHERE id=?").bind(imageUrl,Number(body.id)).run();
    } else if (action === "deals-create") {
      if (!["CEO","Gerente de vendas","Corretor"].includes(String(user.role))) return err("Sem permissão.",403);
      const propertyId=Number(body.propertyId), clientName=clean(body.clientName,100),clientPhone=digits(body.clientPhone), notes=clean(body.notes,1000);
      if (!propertyId||!clientName||clientPhone.length<10) return err("Confira os dados da negociação.");
      const brokerId=user.role==="Corretor" ? user.id : Number(body.brokerId||user.id);
      const broker=await DB().prepare("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('Corretor','Gerente de vendas','CEO')").bind(brokerId).first();
      const property=await DB().prepare("SELECT id FROM properties WHERE id=? AND status='disponivel'").bind(propertyId).first();
      if (!broker||!property) return err("Corretor ou imóvel indisponível.");
      await DB().prepare("INSERT INTO deals (property_id,broker_id,client_name,client_phone,stage,notes,created_at) VALUES (?,?,?,?,'contato',?,?)").bind(propertyId,brokerId,clientName,clientPhone,notes,now()).run();
    } else if (action === "deals-stage") {
      if (!["CEO","Gerente de vendas","Corretor"].includes(String(user.role))) return err("Sem permissão.",403);
      const stage=clean(body.stage,30); if (!["contato","visita","proposta","contrato","concluido","perdido"].includes(stage)) return err("Etapa inválida.");
      const sql=user.role==="Corretor" ? "UPDATE deals SET stage=? WHERE id=? AND broker_id=?" : "UPDATE deals SET stage=? WHERE id=?";
      await (user.role==="Corretor" ? DB().prepare(sql).bind(stage,Number(body.id),user.id) : DB().prepare(sql).bind(stage,Number(body.id))).run();
    } else if (action === "payments-create") {
      if (!["CEO","Analista financeiro"].includes(String(user.role))) return err("Sem permissão.",403);
      const dealId=Number(body.dealId),amount=Number(body.amount),dueDate=clean(body.dueDate,10),note=clean(body.note,500);
      if (!dealId||!Number.isInteger(amount)||amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return err("Confira os dados do pagamento.");
      await DB().prepare("INSERT INTO payments (deal_id,amount,due_date,note) VALUES (?,?,?,?)").bind(dealId,amount,dueDate,note).run();
    } else if (action === "payments-paid") {
      if (!["CEO","Analista financeiro"].includes(String(user.role))) return err("Sem permissão.",403);
      await DB().prepare("UPDATE payments SET paid_at=? WHERE id=? AND paid_at IS NULL").bind(now(),Number(body.id)).run();
    } else if (action === "contacts-status") {
      const status=clean(body.status,20); if (!["novo","em contato","concluido"].includes(status)) return err("Status inválido.");
      await DB().prepare("UPDATE owner_contacts SET status=? WHERE id=?").bind(status,Number(body.id)).run();
    } else if (action === "social-create") {
      if (!["CEO","Marketing"].includes(String(user.role))) return err("Sem permissão.",403);
      const label=clean(body.label,60),url=clean(body.url,500); if (!label||!/^https:\/\//i.test(url)) return err("Informe nome e link HTTPS.");
      await DB().prepare("INSERT INTO social_links (label,url) VALUES (?,?)").bind(label,url).run();
    } else if (action === "users-create") {
      if (!["CEO","TI"].includes(String(user.role))) return err("Sem permissão.",403);
      const cpf=digits(body.cpf),name=clean(body.name,100),email=clean(body.email,150).toLowerCase(),phone=digits(body.phone),role=clean(body.role,40),password=String(body.password??"");
      if (!validCPF(cpf)||!name||!email.includes("@")||phone.length<10||!roles.includes(role)||password.length<12) return err("Confira os dados do funcionário. A senha precisa de 12 caracteres.");
      if (user.role==="TI" && ["CEO","TI"].includes(role)) return err("Apenas o CEO pode cadastrar CEO ou TI.",403);
      await DB().prepare("INSERT INTO users (cpf,name,email,phone,role,password_hash,active,created_at) VALUES (?,?,?,?,?,?,1,?)").bind(cpf,name,email,phone,role,await hashPassword(password),now()).run();
    } else if (action === "users-active") {
      if (user.role!=="CEO") return err("Apenas o CEO pode alterar acessos.",403);
      if (Number(body.id)===user.id) return err("Você não pode desativar sua própria conta.");
      await DB().prepare("UPDATE users SET active=? WHERE id=?").bind(body.active?1:0,Number(body.id)).run();
    } else return err("Ação desconhecida.",404);
    return Response.json({ ok:true });
  } catch (e) { console.error("MGL POST", e); return err("Não foi possível concluir. Verifique os dados e tente novamente.",500); }
}
