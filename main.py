import os, json, html, asyncio
from pathlib import Path
from datetime import datetime, timezone
import discord
from discord.ext import commands
from dotenv import load_dotenv

BASE=Path(__file__).parent
CFG=json.loads((BASE/"config.json").read_text())
DATA=BASE/"data"; DATA.mkdir(exist_ok=True)
OWNER=int(CFG["roles"]["owner"]); STAFF=int(CFG["roles"]["staff"])
CAT=int(CFG["channels"]["ticket_category"]); VOUCH=int(CFG["channels"]["vouches"])
RECORD=int(CFG["channels"]["deal_records"]); LOGS=int(CFG["channels"]["transcripts"])
E=CFG["emojis"]; lock=asyncio.Lock()
paths={k:DATA/f"{k}.json" for k in ("orders","vouches","records","counters")}
defaults={"orders":{},"vouches":{},"records":{},"counters":{"po":0,"buy":0,"support":0,"deal":0,"vouch":0}}
for k,p in paths.items():
    if not p.exists(): p.write_text(json.dumps(defaults[k],indent=2))
def read(k):
    try:return json.loads(paths[k].read_text())
    except:return defaults[k].copy()
def write(k,v):
    t=paths[k].with_suffix(".tmp"); t.write_text(json.dumps(v,indent=2)); t.replace(paths[k])
async def newid(k,p):
    async with lock:
        c=read("counters"); c[k]=c.get(k,0)+1; write("counters",c); return f"{p}-{c[k]:04d}"
def role(m,r):return isinstance(m,discord.Member) and any(x.id==r for x in m.roles)
def isowner(m):return role(m,OWNER)
def isstaff(m):return isowner(m) or role(m,STAFF)
def now():return datetime.now(timezone.utc).isoformat()
def bychannel(cid):
    for oid,o in read("orders").items():
        if o.get("channel_id")==cid:return oid,o
    return None,None
def member(guild,s):
    d="".join(x for x in s if x.isdigit()); return guild.get_member(int(d)) if d else None

intents=discord.Intents.default(); intents.message_content=True; intents.members=True
bot=commands.Bot(command_prefix="$",intents=intents,help_command=None,case_insensitive=True)

async def create_ticket(i,kind,item="",qty="",payment="",issue=""):
    cat=i.guild.get_channel(CAT)
    if not isinstance(cat,discord.CategoryChannel):return await i.response.send_message("Ticket category error.",ephemeral=True)
    for oid,o in read("orders").items():
        if o.get("client_id")==i.user.id and o.get("kind")==kind and o.get("status")=="active":
            ch=i.guild.get_channel(o.get("channel_id"))
            if ch:return await i.response.send_message(f"You already have an active ticket: {ch.mention}",ephemeral=True)
    if kind=="preorder":oid=await newid("po","PO"); name="preorder"
    elif kind=="buy":oid=await newid("buy","BUY"); name="buy"
    else:oid=await newid("support","SUP"); name="support"
    ow={i.guild.default_role:discord.PermissionOverwrite(view_channel=False),
        i.user:discord.PermissionOverwrite(view_channel=True,send_messages=True,read_message_history=True),
        i.guild.me:discord.PermissionOverwrite(view_channel=True,send_messages=True,manage_channels=True,read_message_history=True)}
    for rid in (OWNER,STAFF):
        r=i.guild.get_role(rid)
        if r:ow[r]=discord.PermissionOverwrite(view_channel=True,send_messages=True,read_message_history=True)
    ch=await i.guild.create_text_channel(f"{name}-{oid.split('-')[-1]}",category=cat,overwrites=ow,topic=f"{kind} | {oid}")
    orders=read("orders"); orders[oid]={"kind":kind,"client_id":i.user.id,"channel_id":ch.id,"item":item,"quantity":qty,"payment":payment,"issue":issue,"status":"active","seller_id":None,"amount":None,"currency":None,"created_at":now()}; write("orders",orders)
    em=discord.Embed(title=f"{E['ticket']} TOWER SUPPLIER • {kind.upper()}",description=f"Order ID: {oid}\nStatus: Active",color=0xFFFFFF)
    if kind in ("buy","preorder"):
        em.add_field(name="Item",value=item,inline=False); em.add_field(name="Quantity",value=qty); em.add_field(name="Payment",value=payment)
    else:em.add_field(name="Support request",value=issue,inline=False)
    await ch.send(content=f"{i.user.mention} <@&{STAFF}>",embed=em,view=Actions())
    await i.response.send_message(f"{E['tick']} Ticket created: {ch.mention}",ephemeral=True)

class Buy(discord.ui.Modal,title="Buy"):
    item=discord.ui.TextInput(label="What do you want to buy?",max_length=100)
    qty=discord.ui.TextInput(label="Quantity",max_length=20)
    pay=discord.ui.TextInput(label="Payment method",placeholder="INR or LTC",max_length=20)
    async def on_submit(self,i):await create_ticket(i,"buy",str(self.item),str(self.qty),str(self.pay))
class Pre(discord.ui.Modal,title="Pre-Order"):
    item=discord.ui.TextInput(label="What do you want to pre-order?",max_length=100)
    qty=discord.ui.TextInput(label="Quantity",max_length=20)
    pay=discord.ui.TextInput(label="Payment method",placeholder="INR or LTC",max_length=20)
    async def on_submit(self,i):await create_ticket(i,"preorder",str(self.item),str(self.qty),str(self.pay))
class Support(discord.ui.Modal,title="Support"):
    issue=discord.ui.TextInput(label="What do you need help with?",style=discord.TextStyle.paragraph,max_length=800)
    async def on_submit(self,i):await create_ticket(i,"support",issue=str(self.issue))
class Panel(discord.ui.View):
    def __init__(self):super().__init__(timeout=None)
    @discord.ui.button(label="Buy Now",emoji=discord.PartialEmoji.from_str(E["money"]),style=discord.ButtonStyle.success,custom_id="ts:buy")
    async def b(self,i,x):await i.response.send_modal(Buy())
    @discord.ui.button(label="Pre-Order",emoji=discord.PartialEmoji.from_str(E["ticket"]),style=discord.ButtonStyle.primary,custom_id="ts:pre")
    async def p(self,i,x):await i.response.send_modal(Pre())
    @discord.ui.button(label="Support",emoji=discord.PartialEmoji.from_str(E["chat"]),style=discord.ButtonStyle.secondary,custom_id="ts:sup")
    async def s(self,i,x):await i.response.send_modal(Support())

async def deal(i,oid,o):
    did=await newid("deal","DR"); rs=read("records")
    rs[did]={"order_id":oid,"kind":o["kind"],"item":o.get("item"),"quantity":o.get("quantity"),"seller_id":o.get("seller_id"),"currency":o.get("currency"),"amount":o.get("amount"),"completed_at":now()}; write("records",rs)
    ch=i.guild.get_channel(RECORD)
    if ch:
        seller=f"<@{o['seller_id']}>" if o.get("seller_id") else "Staff"
        em=discord.Embed(title=f"{E['tick']} TOWER SUPPLIER • DEAL COMPLETED",color=0xFFFFFF)
        pay=f"{E['ltc']} LTC" if o.get("currency")=="LTC" else f"{E['money']} ₹"
        em.description=f"**Record ID:** `{did}`\n**Order ID:** `{oid}`\n**Type:** {o['kind'].title()}\n**Seller:** {seller}\n**Deal:** {pay} • **{o.get('amount','-')}**\n**Status:** {E['tick']} Completed"
        if o.get("item"):em.add_field(name="Item",value=o["item"]);em.add_field(name="Quantity",value=o.get("quantity") or "-")
        em.set_footer(text="Client identity is not displayed.")
        await ch.send(embed=em)
    return did
async def complete(i,oid,o,currency=None,amount=None):
    orders=read("orders")
    if orders[oid]["status"]!="active":return await i.response.send_message(f"{E['alert']} Already processed.",ephemeral=True)
    orders[oid]["status"]="completed"; orders[oid]["completed_at"]=now()
    if not orders[oid].get("seller_id"):orders[oid]["seller_id"]=i.user.id
    orders[oid]["currency"]=currency; orders[oid]["amount"]=amount
    write("orders",orders); did=await deal(i,oid,orders[oid])
    await i.response.send_message(
        f"{E['tick']} **{oid} COMPLETED**\n{E['money']} Deal: **{currency} {amount}**\n"
        f"{E['blue_arrow']} Deal Record: `{did}`\n\nClient can now create their vouch below.",
        view=TicketVouchView()
    )

class CompleteDeal(discord.ui.Modal,title="Complete Deal"):
    currency=discord.ui.TextInput(label="Deal currency",placeholder="INR or LTC",max_length=3)
    amount=discord.ui.TextInput(label="Final deal amount",placeholder="Example: 500 or 0.0042",max_length=30)
    async def on_submit(self,i):
        cur=str(self.currency).upper().strip()
        if cur not in ("INR","LTC"):return await i.response.send_message(f"{E['alert']} Currency must be INR or LTC.",ephemeral=True)
        raw=str(self.amount).replace(",","").replace("₹","").strip()
        try:
            if float(raw)<=0:raise ValueError
        except ValueError:return await i.response.send_message(f"{E['alert']} Enter a valid positive amount.",ephemeral=True)
        oid,o=bychannel(i.channel_id)
        if not o or o["kind"]=="support":return await i.response.send_message("Order not found.",ephemeral=True)
        await complete(i,oid,o,cur,raw)
class Cancel(discord.ui.Modal,title="Cancel Order"):
    reason=discord.ui.TextInput(label="Reason",style=discord.TextStyle.paragraph,max_length=300)
    async def on_submit(self,i):
        oid,o=bychannel(i.channel_id)
        if not o:return await i.response.send_message("Order not found.",ephemeral=True)
        orders=read("orders");orders[oid]["status"]="cancelled";orders[oid]["cancel_reason"]=str(self.reason);write("orders",orders)
        await i.response.send_message(f"{E['alert']} {oid} cancelled. Reason: {self.reason}")

async def transcript(ch,oid):
    rows=[]
    async for m in ch.history(limit=None,oldest_first=True):
        a=html.escape(m.author.display_name);t=m.created_at.strftime("%Y-%m-%d %H:%M:%S UTC");c=html.escape(m.content or "")
        rows.append(f"<div class='m'><b>{a}</b> <span>{t}</span><p>{c}</p></div>")
    doc=f"""<!doctype html><html><head><meta charset="utf-8"><style>body{{font-family:Arial;background:#111;color:#eee;max-width:900px;margin:auto;padding:24px}}.m{{padding:12px;border-bottom:1px solid #333}}span{{color:#aaa}}p{{white-space:pre-wrap}}</style></head><body><h1>Tower Supplier - {html.escape(oid)}</h1>{''.join(rows)}</body></html>"""
    p=BASE/f"{oid}.html";p.write_text(doc);return p

class Actions(discord.ui.View):
    def __init__(self):super().__init__(timeout=None)
    async def interaction_check(self,i):
        if not isstaff(i.user):await i.response.send_message("Staff only.",ephemeral=True);return False
        return True
    @discord.ui.button(label="Claim",style=discord.ButtonStyle.primary,custom_id="ts:claim")
    async def claim(self,i,x):
        oid,o=bychannel(i.channel_id)
        if not o:return await i.response.send_message("Ticket not found.",ephemeral=True)
        orders=read("orders")
        if orders[oid].get("seller_id") and orders[oid]["seller_id"]!=i.user.id:return await i.response.send_message("Already claimed.",ephemeral=True)
        orders[oid]["seller_id"]=i.user.id;write("orders",orders);await i.response.send_message(f"{E['tick']} Claimed by {i.user.mention}.")
    @discord.ui.button(label="Complete",style=discord.ButtonStyle.success,custom_id="ts:complete")
    async def done(self,i,x):
        oid,o=bychannel(i.channel_id)
        if not o:return await i.response.send_message("Ticket not found.",ephemeral=True)
        if o["kind"]=="support":return await i.response.send_message("Close support when resolved.",ephemeral=True)
        return await i.response.send_modal(CompleteDeal())
    @discord.ui.button(label="Cancel",style=discord.ButtonStyle.danger,custom_id="ts:cancel")
    async def cancel(self,i,x):
        oid,o=bychannel(i.channel_id)
        if not o or o["kind"]=="support":return await i.response.send_message("Not available here.",ephemeral=True)
        await i.response.send_modal(Cancel())
    @discord.ui.button(label="Close",style=discord.ButtonStyle.secondary,custom_id="ts:close")
    async def close(self,i,x):
        oid,o=bychannel(i.channel_id);oid=oid or f"TICKET-{i.channel_id}"
        await i.response.send_message("Saving transcript and closing...")
        p=await transcript(i.channel,oid);log=i.guild.get_channel(LOGS)
        if log:await log.send(content=f"Ticket: {oid}\nType: {o['kind'].title() if o else 'Unknown'}\nStatus: {o.get('status','closed').title() if o else 'Closed'}",file=discord.File(p))
        try:p.unlink()
        except:pass
        await asyncio.sleep(2);await i.channel.delete(reason=f"Closed {oid}")

class TicketVouchView(discord.ui.View):
    def __init__(self):super().__init__(timeout=None)
    @discord.ui.button(label="Create Vouch",emoji=discord.PartialEmoji.from_str(E["tick"]),style=discord.ButtonStyle.success,custom_id="ts:ticket_vouch")
    async def create_vouch(self,i,x):
        oid,o=bychannel(i.channel_id)
        if not o or o.get("status")!="completed":return await i.response.send_message(f"{E['alert']} This deal must be completed first.",ephemeral=True)
        if o.get("client_id")!=i.user.id:return await i.response.send_message(f"{E['alert']} Only the client for this order can vouch.",ephemeral=True)
        await i.response.send_modal(TicketVouchModal(oid))

class TicketVouchModal(discord.ui.Modal,title="Vouch for this Deal"):
    stars=discord.ui.TextInput(label="Rating",placeholder="1 to 5",max_length=1)
    review=discord.ui.TextInput(label="Review",style=discord.TextStyle.paragraph,max_length=500)
    def __init__(self,oid):
        super().__init__(); self.order_id=oid
    async def on_submit(self,i):
        oid=self.order_id; o=read("orders").get(oid); vs=read("vouches")
        if not o or o.get("status")!="completed":return await i.response.send_message("Completed order not found.",ephemeral=True)
        if o.get("client_id")!=i.user.id:return await i.response.send_message("This is not your order.",ephemeral=True)
        if any(v.get("order_id")==oid for v in vs.values()):return await i.response.send_message(f"{E['alert']} This order already has a vouch.",ephemeral=True)
        try:n=int(str(self.stars))
        except:n=0
        if n not in range(1,6):return await i.response.send_message(f"{E['alert']} Rating must be 1-5.",ephemeral=True)
        seller_id=o.get("seller_id")
        if not seller_id:return await i.response.send_message("This order has no claimed seller.",ephemeral=True)
        vid=await newid("vouch","V"); pay="LTC" if o.get("currency")=="LTC" else "INR"
        vs=read("vouches");vs[vid]={"order_id":oid,"seller_id":seller_id,"currency":pay,"stars":n,"review":str(self.review),"submitted_by":i.user.id,"created_at":now()};write("vouches",vs)
        ch=i.guild.get_channel(VOUCH)
        em=discord.Embed(title=f"{E['tick']} TOWER SUPPLIER • VERIFIED VOUCH",color=0xFFFFFF)
        em.description=f"{E['ticket']} **Order:** `{oid}`\n{E['blue_arrow']} **Seller:** <@{seller_id}>\n{E['money'] if pay=='INR' else 'ltc'} **Deal Type:** {'₹' if pay=='INR' else 'LTC'} Deal\n⭐ **Rating:** {'⭐'*n}\n{E['chat']} **Review:** {discord.utils.escape_markdown(str(self.review))}\n\n**Vouch ID:** `{vid}`"
        em.set_footer(text="Verified from a completed Tower Supplier ticket • Client identity hidden")
        await ch.send(embed=em);await i.response.send_message(f"{E['tick']} Vouch `{vid}` posted.",ephemeral=True)

class VouchModal(discord.ui.Modal,title="Leave a Vouch"):
    oid=discord.ui.TextInput(label="Order / Pre-Order ID",placeholder="BUY-0001 or PO-0001",max_length=20)
    stars=discord.ui.TextInput(label="Rating",placeholder="1 to 5",max_length=1)
    review=discord.ui.TextInput(label="Review",style=discord.TextStyle.paragraph,max_length=500)
    async def on_submit(self,i):
        oid=str(self.oid).upper().strip();o=read("orders").get(oid)
        if not o or o.get("status")!="completed":return await i.response.send_message(f"{E['alert']} Completed order not found.",ephemeral=True)
        if o.get("client_id")!=i.user.id:return await i.response.send_message(f"{E['alert']} That order is not yours.",ephemeral=True)
        vs=read("vouches")
        if any(v.get("order_id")==oid for v in vs.values()):return await i.response.send_message(f"{E['alert']} This order already has a vouch.",ephemeral=True)
        seller_id=o.get("seller_id")
        if not seller_id:return await i.response.send_message(f"{E['alert']} This order was not claimed by staff.",ephemeral=True)
        try:n=int(str(self.stars))
        except:n=0
        if n not in range(1,6):return await i.response.send_message(f"{E['alert']} Rating must be 1-5.",ephemeral=True)
        pay="LTC" if o.get("currency")=="LTC" else "INR"
        vid=await newid("vouch","V");vs=read("vouches")
        vs[vid]={"order_id":oid,"seller_id":seller_id,"currency":pay,"stars":n,"review":str(self.review),"submitted_by":i.user.id,"created_at":now()};write("vouches",vs)
        ch=i.guild.get_channel(VOUCH)
        if not ch:return await i.response.send_message(f"{E['alert']} Vouch channel is not configured.",ephemeral=True)
        symbol="LTC" if pay=="LTC" else "₹"
        em=discord.Embed(
            title=f"{E['tick']} TOWER SUPPLIER • VERIFIED VOUCH",
            description=(
                f"{E['ticket']} **Order:** `{oid}`\n"
                f"{E['blue_arrow']} **Seller:** <@{seller_id}>\n"
                f"{E['money'] if pay=='INR' else E['ltc']} **Deal Type:** {symbol} Deal\n"
                f"⭐ **Rating:** {'⭐'*n}\n"
                f"{E['chat']} **Review:** {discord.utils.escape_markdown(str(self.review))}\n\n"
                f"**Vouch ID:** `{vid}`"
            ),
            color=0xFFFFFF
        )
        em.set_footer(text="Seller verified from the staff member who claimed the ticket • Client identity hidden")
        await ch.send(embed=em)
        await i.response.send_message(f"{E['tick']} Vouch `{vid}` posted for <@{seller_id}>.",ephemeral=True)

class VouchView(discord.ui.View):
    def __init__(self):super().__init__(timeout=None)
    @discord.ui.button(label="Leave a Vouch",emoji=discord.PartialEmoji.from_str(E["tick"]),style=discord.ButtonStyle.success,custom_id="ts:vouch")
    async def go(self,i,x):await i.response.send_modal(VouchModal())

@bot.event
async def on_ready():
    bot.add_view(Panel());bot.add_view(Actions());bot.add_view(VouchView());bot.add_view(TicketVouchView());print("Tower Supplier online",bot.user)
@bot.command()
async def panel(ctx):
    if not isowner(ctx.author):return
    em=discord.Embed(
        title=f"{E['ticket']} TOWER SUPPLIER • ORDER CENTER",
        description=(
            f"{E['announcement']} **WELCOME TO TOWER SUPPLIER**\n"
            f"Fast, organized and secure order handling. Choose the correct option below to get started.\n\n"
            f"{E['money']} **BUY**\n"
            f"{E['blue_arrow']} Purchase currently available stock.\n"
            f"{E['dot']} Fill in the item, quantity and payment method.\n\n"
            f"{E['ticket']} **PRE-ORDER**\n"
            f"{E['blue_arrow']} Reserve an item/tower before stock is available.\n"
            f"{E['dot']} Your order receives a permanent `PO-XXXX` ID.\n\n"
            f"{E['chat']} **SUPPORT**\n"
            f"{E['blue_arrow']} Questions, order problems or other assistance.\n\n"
            f"{E['cash']} **PAYMENT METHODS**\n"
            f"{E['money']} **₹ INR**  •  {E['ltc']} **LTC**\n\n"
            f"{E['tick']} Completed orders receive a verified deal record and an in-ticket **Create Vouch** option."
        ),
        color=0xFFFFFF
    )
    em.set_footer(text="Tower Supplier • Invite Only • Select an option below")
    await ctx.send(embed=em,view=Panel())
@bot.command()
async def vouch(ctx):
    if not isstaff(ctx.author):return
    await ctx.send(embed=discord.Embed(title=f"{E['tick']} LEAVE A VOUCH",description="Enter your **Order ID, Rating and Review**. The bot automatically mentions the staff member who claimed your ticket. No client identity or deal amount is shown publicly.",color=0xFFFFFF),view=VouchView())
@bot.command()
async def stats(ctx):
    if not isowner(ctx.author):return
    pos=[o for o in read("orders").values() if o["kind"]=="preorder"];a=sum(o["status"]=="active" for o in pos);c=sum(o["status"]=="completed" for o in pos);x=sum(o["status"]=="cancelled" for o in pos);ir=lt=0.0
    for o in pos:
        if o["status"]=="completed" and o.get("amount"):
            try:
                v=float(str(o["amount"]).replace(",","").replace("₹","").strip())
                if o.get("currency")=="INR":ir+=v
                elif o.get("currency")=="LTC":lt+=v
            except:pass
    await ctx.send(embed=discord.Embed(title=f"{E['money']} TOWER SUPPLIER • STATS",description=f"Pre-Orders: {len(pos)}\nActive: {a}\nCompleted: {c}\nCancelled: {x}\n\nCompleted value\nINR: ₹{ir:,.2f}\nLTC: {lt:.8f} LTC\n\nDeals: {len(read('records'))}\nVouches: {len(read('vouches'))}",color=0xFFFFFF))
@bot.command()
async def order(ctx,oid=""):
    if not isstaff(ctx.author):return
    key=oid.upper();o=read("orders").get(key)
    if not o:return await ctx.send(f"{E['alert']} Order not found.")
    seller=f"<@{o['seller_id']}>" if o.get("seller_id") else "Unclaimed"
    deal=(f"{'₹' if o.get('currency')=='INR' else 'LTC'} {o.get('amount')}" if o.get("amount") else "Not completed")
    em=discord.Embed(title=f"{E['ticket']} ORDER • {key}",color=0xFFFFFF)
    em.description=f"**Type:** {o.get('kind','-').title()}\n**Item:** {o.get('item') or '-'}\n**Quantity:** {o.get('quantity') or '-'}\n**Payment:** {o.get('payment') or '-'}\n**Status:** {o.get('status','-').title()}\n**Seller:** {seller}\n**Final Deal:** {deal}"
    await ctx.send(embed=em)

@bot.command()
async def preorders(ctx):
    if not isowner(ctx.author):return
    a=[(k,o) for k,o in read("orders").items() if o["kind"]=="preorder" and o["status"]=="active"]
    await ctx.send("\n".join(f"{k} • {o.get('item')} x {o.get('quantity')}" for k,o in a[:40]) or "No active pre-orders.")
@bot.command()
async def preorder(ctx,oid=""):
    if not isstaff(ctx.author):return
    o=read("orders").get(oid.upper())
    if not o or o["kind"]!="preorder":return await ctx.send("Pre-order not found.")
    seller=f"<@{o['seller_id']}>" if o.get("seller_id") else "Unclaimed"
    await ctx.send(embed=discord.Embed(title=f"{E['ticket']} Pre-Order Record",description=f"ID: {oid.upper()}\nItem: {o.get('item')}\nQuantity: {o.get('quantity')}\nStatus: {o.get('status').title()}\nSeller: {seller}\nPayment: {o.get('payment')}",color=0xFFFFFF))
@bot.command()
async def deletepreorder(ctx,oid=""):
    if not isowner(ctx.author):return
    orders=read("orders");key=oid.upper();o=orders.get(key)
    if not o or o["kind"]!="preorder":return await ctx.send("Pre-order not found.")
    if o["status"]=="completed":return await ctx.send("Completed records cannot be deleted.")
    del orders[key];write("orders",orders);await ctx.send(f"{E['tick']} {key} removed.")
@bot.command(name="help")
async def helpcmd(ctx):
    em=discord.Embed(
        title=f"{E['announcement']} TOWER SUPPLIER • HELP",
        description=(
            f"{E['ticket']} **Ticket System**\n"
            f"{E['blue_arrow']} `$panel` — Post the Buy / Pre-Order / Support panel *(Owner)*\n"
            f"{E['chat']} `$vouch` — Vouch form uses the claimed staff automatically *(Staff / Owner)*\n"
            f"{E['tick']} Completed tickets automatically get a **Create Vouch** button\n\n"
            f"{E['money']} **Pre-Orders & Records**\n"
            f"{E['blue_arrow']} `$stats` — View pre-order, deal and vouch stats *(Owner)*\n"
            f"{E['blue_arrow']} `$order BUY-XXXX / PO-XXXX` — View full order *(Staff / Owner)*\n"
            f"{E['blue_arrow']} `$preorders` — View active pre-orders *(Owner)*\n"
            f"{E['blue_arrow']} `$preorder PO-XXXX` — Look up a pre-order *(Staff / Owner)*\n"
            f"{E['alert']} `$deletepreorder PO-XXXX` — Remove an accidental active/cancelled pre-order *(Owner)*\n\n"
            f"{E['tick']} Ticket buttons: **Claim • Complete • Cancel • Close**\n"
            f"{E['ltc']} Deal totals keep **₹ and LTC separate**."
        ),
        color=0xFFFFFF
    )
    em.set_footer(text="Tower Supplier • Prefix: $")
    await ctx.send(embed=em)

load_dotenv();token=os.getenv("DISCORD_TOKEN")
if not token:raise RuntimeError("DISCORD_TOKEN missing. Copy .env.example to .env.")
bot.run(token)
