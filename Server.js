const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');

const app = express();
const db = new Database('vouches.db');

// 1. DATABASE SETUP
db.prepare(`
  CREATE TABLE IF NOT EXISTS vouches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receiver_id TEXT,
    giver_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 2. WEBSITE HOMEPAGE
app.get('/', (request, response) => {
  // Pull total vouches to show on the webpage
  const total = db.prepare('SELECT COUNT(*) as count FROM vouches').get();
  
  // Pull top 3 traders for the website leaderboard
  const leaders = db.prepare(`
    SELECT receiver_id, COUNT(*) as count 
    FROM vouches 
    GROUP BY receiver_id 
    ORDER BY count DESC 
    LIMIT 3
  `).all();

  let leaderboardHTML = '';
  leaders.forEach((row, index) => {
    leaderboardHTML += `<li>🏅 <b>User ID:</b> ${row.receiver_id} - <b>Vouches:</b> ${row.count}</li>`;
  });

  response.send(`
    <div style="font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #2c2f33; color: white; padding: 40px; border-radius: 10px; max-width: 600px; margin-left: auto; margin-right: auto;">
      <h1>🏴‍☠️ Blox Fruits Server Dashboard 🏴‍☠️</h1>
      <p>Our official Discord bot is active and tracking reputation!</p>
      <h2 style="color: #7289da;">Total Server Vouches: ${total.count}</h2>
      <hr style="border: 1px solid #4f545c;">
      <h3>🏆 Current Top Traders 🏆</h3>
      <ol style="text-align: left; display: inline-block; list-style-type: none; padding: 0;">
        ${leaderboardHTML || '<li>No vouches recorded yet!</li>'}
      </ol>
    </div>
  `);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Website is running on port ' + port);
});

// 3. DISCORD BOT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.on('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // COMMAND: !vouch @user
  if (message.content.startsWith('!vouch')) {
    const member = message.mentions.members.first();

    if (!member) {
      return message.reply('❌ Mention the user you traded with! Example: `!vouch @username`');
    }

    // Anti-Abuse Filter 1: Cannot vouch for yourself
    if (member.id === message.author.id) {
      return message.reply('❌ Nice try, but you cannot vouch for yourself!');
    }

    // Anti-Abuse Filter 2: Screenshot proof requirement
    if (message.attachments.size === 0) {
      return message.reply('❌ You must attach a screenshot of your Roblox/Discord trade chat as proof!');
    }

    // Anti-Abuse Filter 3: Account Age Verification (Must be older than 14 days)
    const accountAgeDays = (Date.now() - message.author.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < 14) {
      return message.reply('❌ Your Discord account must be at least 14 days old to submit vouches (Anti-Alt system).');
    }

    // Save to Database
    const insert = db.prepare('INSERT INTO vouches (receiver_id, giver_id) VALUES (?, ?)');
    insert.run(member.id, message.author.id);

    message.reply(`✅ Vouch successfully recorded for **${member.user.username}**! Proof saved.`);
  }

  // COMMAND: !leaderboard (For Admin use to see Top 3)
  if (message.content === '!leaderboard') {
    const rows = db.prepare(`
      SELECT receiver_id, COUNT(*) as count 
      FROM vouches 
      GROUP BY receiver_id 
      ORDER BY count DESC 
      LIMIT 3
    `).all();

    if (rows.length === 0) {
      return message.reply("No vouches have been recorded this month yet!");
    }

    const embed = new EmbedBuilder()
      .setTitle("🏆 Top 3 Trusted Blox Fruits Traders 🏆")
      .setColor(0x00AE86)
      .setDescription("Here are the traders with the most vouches this month:")
      .setTimestamp();

    const medals = ["🥇 1st Place", "🥈 2nd Place", "🥉 3rd Place"];
    
    rows.forEach((row, index) => {
      embed.addField({
        name: medals[index],
        value: `<@${row.receiver_id}> with **${row.count}** vouches!`,
        inline: false
      });
    });

    message.channel.send({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
