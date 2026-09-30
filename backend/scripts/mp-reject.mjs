import 'dotenv/config';
import crypto from 'node:crypto';
const A=process.env.MP_ACCESS_TOKEN,P=process.env.MP_PUBLIC_KEY,B='https://api.mercadopago.com';
async function tok(name){const r=await fetch(`${B}/v1/card_tokens?public_key=${P}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_number:'5474925432670366',expiration_month:11,expiration_year:2030,security_code:'123',cardholder:{name,identification:{type:'CPF',number:'12345678909'}}})});const j=await r.json();return j.id;}
async function ord(name,token){const r=await fetch(`${B}/v1/orders`,{method:'POST',headers:{Authorization:`Bearer ${A}`,'Content-Type':'application/json','X-Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({type:'online',processing_mode:'automatic',external_reference:`R-${Date.now()}`,total_amount:'10.00',payer:{email:'test_user_x@testuser.com'},transactions:{payments:[{amount:'10.00',payment_method:{id:'master',type:'credit_card',token,installments:1}}]}})});const t=await r.text();console.log(`\n== ${name} HTTP ${r.status} ==\n`+t);}
for(const h of ['OTHE','CONT','FUND']){const tk=await tok(h);await ord(`holder ${h}`,tk);}
