const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');

const app = express();
const db = new Database('vouches.db');

// 1. DATABASE SETUP
// We update the table to include the receiver's Discord Username
try {
  db.prepare("ALTER TABLE vouches ADD COLUMN receiver_name TEXT").run();
} catch (e) {
  // If the column already exists, do nothing!
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS vouches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receiver_id TEXT,
    giver_id TEXT,
    receiver_name TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 2. WEBSITE HOMEPAGE (Upgraded UI + Monthly Sorting)
app.get('/', (request, response) => {
  
  // -- GET ALL TIME DATA --
  const allTimeTotal = db.prepare('SELECT COUNT(*) as count FROM vouches').get();
  const allTimeLeaders = db.prepare(`
    SELECT receiver_id, receiver_name, COUNT(*) as count 
    FROM vouches 
    GROUP BY receiver_id 
    ORDER BY count DESC 
    LIMIT 5
  `).all();

  // -- GET CURRENT MONTH DATA --
  const monthTotal = db.prepare(`
    SELECT COUNT(*) as count FROM vouches 
    WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
  `).get();
  
  const monthLeaders = db.prepare(`
    SELECT receiver_id, receiver_name, COUNT(*) as count 
    FROM vouches 
    WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
    GROUP BY receiver_id 
    ORDER BY count DESC 
    LIMIT 5
  `).all();

  // Helper function to draw the leaderboard cards
  const buildList = (leaders) => {
    if (leaders.length === 0) return '<p style="color: #aaa; padding: 20px;">No vouches yet!</p>';
    let html = '';
    const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
    leaders.forEach((row, index) => {
      const name = row.receiver_name || `User ID: ${row.receiver_id}`;
      html += `
        <div class="leaderboard-card">
          <span class="medal">${medals[index]}</span>
          <span class="username">${name}</span>
          <span class="score">${row.count} Vouches</span>
        </div>
      `;
    });
    return html;
  };

  // The actual website design (HTML/CSS)
  response.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Blox Fruits Vouch Dashboard</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          background-color: #121212;
          background-image: radial-gradient(circle at top right, #2a1147, #121212);
          color: #ffffff;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          margin: 0;
          padding: 30px 20px;
          text-align: center;
        }
        h1 { color: #bb86fc; font-size: 2.5em; text-shadow: 0 0 15px rgba(187,134,252,0.5); margin-bottom: 5px; }
        p.subtitle { color: #cccccc; margin-top: 0; font-size: 1.1em; margin-bottom: 40px; }
        
        .container {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 30px;
          max-width: 1000px;
          margin: 0 auto;
        }
        
        .section-box {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 15px;
          padding: 25px;
          flex: 1;
          min-width: 300px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(10px);
        }
        
        .section-box h2 {
          border-bottom: 2px solid #bb86fc;
          padding-bottom: 15px;
          margin-top: 0;
          text-transform: uppercase;
          letter-spacing: 2px;
          font-size: 1.3em;
        }
        
        .total-badge {
          background: #bb86fc;
          color: #121212;
          font-weight: bold;
          padding: 5px 15px;
          border-radius: 20px;
          display: inline-block;
          margin-bottom: 20px;
          font-size: 1.1em;
          box-shadow: 0 0 10px rgba(187,134,252,0.4);
        }
        
        .leaderboard-card {
          background: rgba(0, 0, 0, 0.4);
          margin: 12px 0;
          padding: 15px 20px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: all 0.3s ease;
          border-left: 4px solid transparent;
        }
        
        .leaderboard-card:hover {
          transform: translateY(-3px);
          background: rgba(187, 134, 252, 0.1);
          border-left: 4px solid #bb86fc;
          box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        
        .medal { font-size: 1.5em; }
        .username { font-weight: bold; font-size: 1.1em; flex-grow: 1; text-align: left; margin-left: 15px; }
        .score { color: #03dac6; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>🏴‍☠️ Blox Fruits Traders 🏴‍☠️</h1>
      <p class="subtitle">Live Server Vouch Leaderboard</p>
      
      <div class="container">
        <div class="section-box">
          <h2>📅 This Month</h2>
          <div class="total-badge">Total Vouches: ${monthTotal.count}</div>
          ${buildList(monthLeaders)}
        </div>

        <div class="section-box">
          <h2>🌟 All-Time Legends</h2>
          <div class="total-badge">Total Vouches: ${allTimeTotal.count}</div>
          ${buildList(allTimeLeaders)}
        </div>
      </div>
    </body>
    </html>
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

  if (message.content.startsWith('!vouch')) {
    const member = message.mentions.members.first();

    if (!member) {
      return message.reply('❌ Mention the user you traded with! Example: `!vouch @username`');
    }

    if (member.id === message.author.id) {
      return message.reply('❌ Nice try, but you cannot vouch for yourself!');
    }

    if (message.attachments.size === 0) {
      return message.reply('❌ You must attach a screenshot of your Roblox/Discord trade chat as proof!');
    }

    const accountAgeDays = (Date.now() - message.author.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < 14) {
      return message.reply('❌ Your Discord account must be at least 14 days old to submit vouches (Anti-Alt system).');
    }

    // Save to Database (Now saving their actual Discord username!)
    const insert = db.prepare('INSERT INTO vouches (receiver_id, giver_id, receiver_name) VALUES (?, ?, ?)');
    insert.run(member.id, message.author.id, member.user.username);

    message.reply(`✅ Vouch successfully recorded for **${member.user.username}**! Proof saved.`);
  }

  // Monthly leaderboard command for Discord
  if (message.content === '!leaderboard') {
    const rows = db.prepare(`
      SELECT receiver_id, COUNT(*) as count 
      FROM vouches 
      WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
      GROUP BY receiver_id 
      ORDER BY count DESC 
      LIMIT 3
    `).all();

    if (rows.length === 0) {
      return message.reply("No vouches have been recorded this month yet!");
    }

    const embed = new EmbedBuilder()
      .setTitle("🏆 Top 3 Trusted Traders This Month 🏆")
      .setColor(0x00AE86)
      .setDescription("Here are the traders with the most vouches this month:")
      .setTimestamp();

    const medals = ["🥇 1st Place", "🥈 2nd Place", "🥉 3rd Place"];
    
    rows.forEach((row, index) => {
      embed.addFields({
        name: medals[index],
        value: `<@${row.receiver_id}> with **${row.count}** vouches!`,
        inline: false
      });
    });

    message.channel.send({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
