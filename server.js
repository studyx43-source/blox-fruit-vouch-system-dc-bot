const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');

const app = express();
const db = new Database('vouches.db');

// 1. DATABASE SETUP
try { db.prepare("ALTER TABLE vouches ADD COLUMN receiver_name TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE vouches ADD COLUMN review TEXT").run(); } catch (e) {}

db.prepare(`
  CREATE TABLE IF NOT EXISTS vouches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receiver_id TEXT,
    giver_id TEXT,
    receiver_name TEXT,
    review TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 2. WEBSITE HOMEPAGE
app.get('/', (request, response) => {
  const searchTerm = request.query.search || '';
  
  const allTimeTotal = db.prepare('SELECT COUNT(*) as count FROM vouches').get();
  const allTimeLeaders = db.prepare(`
    SELECT receiver_id, receiver_name, COUNT(*) as count 
    FROM vouches GROUP BY receiver_id ORDER BY count DESC LIMIT 5
  `).all();

  const monthTotal = db.prepare(`
    SELECT COUNT(*) as count FROM vouches 
    WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
  `).get();
  
  const monthLeaders = db.prepare(`
    SELECT receiver_id, receiver_name, COUNT(*) as count 
    FROM vouches 
    WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
    GROUP BY receiver_id ORDER BY count DESC LIMIT 5
  `).all();

  const recentReviews = db.prepare(`
    SELECT receiver_name, review, timestamp 
    FROM vouches 
    ORDER BY timestamp DESC 
    LIMIT 5
  `).all();

  let searchResultsHTML = '';
  if (searchTerm) {
    const searchResults = db.prepare(`
      SELECT receiver_id, receiver_name, COUNT(*) as count 
      FROM vouches WHERE receiver_name LIKE ?
      GROUP BY receiver_id ORDER BY count DESC
    `).all(`%${searchTerm}%`);

    if (searchResults.length === 0) {
      searchResultsHTML = `
        <div class="section-box search-box" style="width: 100%; max-width: 1000px; margin-bottom: 30px; border-color: #ff4a4a;">
          <h2 style="color: #ff4a4a; border-bottom-color: #ff4a4a;">🔍 Search Results</h2>
          <p style="color: #aaa; padding: 10px;">No players found matching "${searchTerm}"</p>
        </div>`;
    } else {
      let cardList = '';
      searchResults.forEach((row) => {
        const name = row.receiver_name || `User ID: ${row.receiver_id}`;
        cardList += `
          <div class="leaderboard-card">
            <span class="medal">👤</span>
            <span class="username">${name}</span>
            <span class="score">${row.count} Total Vouches</span>
          </div>
        `;
      });
      searchResultsHTML = `
        <div class="section-box search-box" style="width: 100%; max-width: 1000px; margin-bottom: 30px; border-color: #03dac6;">
          <h2 style="color: #03dac6; border-bottom-color: #03dac6;">🔍 Search Results for "${searchTerm}"</h2>
          ${cardList}
        </div>`;
    }
  }

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

  const buildReviewFeed = (reviews) => {
    if (reviews.length === 0) return '<p style="color: #aaa;">No vouches posted yet.</p>';
    let html = '';
    reviews.forEach((row) => {
      const name = row.receiver_name || `A user`;
      const reviewText = row.review || 'No comment provided.';
      html += `
        <div class="review-card">
          <div class="review-header">⭐ Vouch for <b>${name}</b></div>
          <div class="review-body">"${reviewText}"</div>
        </div>
      `;
    });
    return html;
  };

  response.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Blox Fruits Vouch Dashboard</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { background-color: #121212; background-image: radial-gradient(circle at top right, #2a1147, #121212); color: #ffffff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 30px 20px; text-align: center; }
        h1 { color: #bb86fc; font-size: 2.5em; text-shadow: 0 0 15px rgba(187,134,252,0.5); margin-bottom: 5px; }
        p.subtitle { color: #cccccc; margin-top: 0; font-size: 1.1em; margin-bottom: 30px; }
        .search-container { margin-bottom: 40px; }
        .search-form { display: inline-flex; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(187, 134, 252, 0.3); border-radius: 30px; padding: 5px 5px 5px 20px; align-items: center; transition: all 0.3s ease; }
        .search-form:focus-within { border-color: #bb86fc; box-shadow: 0 0 15px rgba(187,134,252,0.3); }
        .search-input { background: none; border: none; color: white; font-size: 1em; outline: none; width: 200px; }
        .search-btn { background: #bb86fc; color: #121212; border: none; padding: 10px 20px; border-radius: 25px; font-weight: bold; cursor: pointer; margin-left: 10px; transition: all 0.3s; }
        .search-btn:hover { background: #03dac6; box-shadow: 0 0 10px rgba(3,218,198,0.5); }
        .container { display: flex; flex-wrap: wrap; justify-content: center; gap: 30px; max-width: 1000px; margin: 0 auto; }
        .section-box { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 15px; padding: 25px; flex: 1; min-width: 300px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); backdrop-filter: blur(10px); }
        .section-box h2 { border-bottom: 2px solid #bb86fc; padding-bottom: 15px; margin-top: 0; text-transform: uppercase; letter-spacing: 2px; font-size: 1.3em; }
        .total-badge { background: #bb86fc; color: #121212; font-weight: bold; padding: 5px 15px; border-radius: 20px; display: inline-block; margin-bottom: 20px; font-size: 1.1em; box-shadow: 0 0 10px rgba(187,134,252,0.4); }
        .leaderboard-card { background: rgba(0, 0, 0, 0.4); margin: 12px 0; padding: 15px 20px; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; transition: all 0.3s ease; border-left: 4px solid transparent; }
        .leaderboard-card:hover { transform: translateY(-3px); background: rgba(187, 134, 252, 0.1); border-left: 4px solid #bb86fc; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
        .medal { font-size: 1.5em; }
        .username { font-weight: bold; font-size: 1.1em; flex-grow: 1; text-align: left; margin-left: 15px; }
        .score { color: #03dac6; font-weight: bold; }
        .review-feed-container { margin-top: 30px; width: 100%; }
        .review-card { background: rgba(0,0,0,0.4); border-left: 4px solid #03dac6; margin: 10px 0; padding: 15px; border-radius: 8px; text-align: left; }
        .review-header { color: #bb86fc; font-size: 0.9em; margin-bottom: 8px; }
        .review-body { font-style: italic; color: #e0e0e0; }
      </style>
    </head>
    <body>
      <h1>🏴‍☠️ Blox Fruits Traders 🏴‍☠️</h1>
      <p class="subtitle">Live Server Vouch Leaderboard</p>
      
      <div class="search-container">
        <form action="/" method="GET" class="search-form">
          <input type="text" name="search" class="search-input" placeholder="Search player username..." value="${searchTerm}">
          <button type="submit" class="search-btn">Search</button>
        </form>
      </div>

      <div class="container">
        ${searchResultsHTML}
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
        <div class="section-box review-feed-container">
          <h2 style="border-bottom-color: #03dac6;">💬 Recent Vouches</h2>
          ${buildReviewFeed(recentReviews)}
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

// ⬇️ VERY IMPORTANT: PASTE YOUR CHANNEL ID BETWEEN THE QUOTES BELOW ⬇️
const VOUCH_CHANNEL_ID = '1507347264413241364'; 

// Spam protection memory
const cooldowns = new Map();
const COOLDOWN_MINUTES = 5;

client.on('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // COMMAND 1: !vouch
  if (message.content.startsWith('!vouch')) {
    if (message.channel.id !== VOUCH_CHANNEL_ID) {
      return message.reply(`❌ Please use the <#${VOUCH_CHANNEL_ID}> channel to submit vouches!`);
    }

    // Cooldown check (5 minutes)
    if (cooldowns.has(message.author.id)) {
      const expirationTime = cooldowns.get(message.author.id) + (COOLDOWN_MINUTES * 60 * 1000);
      if (Date.now() < expirationTime) {
        const timeLeft = Math.ceil((expirationTime - Date.now()) / 1000 / 60);
        return message.reply(`⏳ You are doing that too fast! Please wait ${timeLeft} more minute(s) before vouching again.`);
      }
    }

    const member = message.mentions.members.first();

    if (!member) {
      return message.reply('❌ Mention the user you traded with! Example: `!vouch @username very fast service!`');
    }

    if (member.id === message.author.id) {
      return message.reply('❌ Nice try, but you cannot vouch for yourself!');
    }

    const accountAgeDays = (Date.now() - message.author.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < 14) {
      return message.reply('❌ Your Discord account must be at least 14 days old to submit vouches.');
    }

    if (message.attachments.size === 0) {
      return message.reply('❌ You must attach a screenshot of your Blox Fruits trade as proof!');
    }

    const args = message.content.split(' ').slice(2);
    const reviewText = args.length > 0 ? args.join(' ') : 'No comment provided.';

    // Save to Database
    const insert = db.prepare('INSERT INTO vouches (receiver_id, giver_id, receiver_name, review) VALUES (?, ?, ?, ?)');
    insert.run(member.id, message.author.id, member.user.username, reviewText);

    // Apply cooldown to the user
    cooldowns.set(message.author.id, Date.now());

    message.reply(`✅ **Vouch Recorded!** Successfully added for **${member.user.username}**.\n💬 *"${reviewText}"*`);
  }

  // COMMAND 2: !check (Check a user's stats)
  if (message.content.startsWith('!check')) {
    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Mention a user to check! Example: `!check @username`');

    const total = db.prepare('SELECT COUNT(*) as count FROM vouches WHERE receiver_id = ?').get(member.id);
    
    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle(`🔍 Vouch Record for ${member.user.username}`)
      .setDescription(`**Total Vouches:** ${total.count}\nCheck the full leaderboard on the website!`)
      .setThumbnail(member.user.displayAvatarURL());

    message.reply({ embeds: [embed] });
  }

  // COMMAND 3: !removevouch (Admin Only)
  if (message.content.startsWith('!removevouch')) {
    // Check if the user sending the message is an Administrator
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ Only server Admins can use this command!');
    }

    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Mention a user to remove their latest vouch! Example: `!removevouch @username`');

    // Find their most recent vouch ID
    const latestVouch = db.prepare('SELECT id FROM vouches WHERE receiver_id = ? ORDER BY timestamp DESC LIMIT 1').get(member.id);
    
    if (!latestVouch) {
      return message.reply(`❌ **${member.user.username}** doesn't have any vouches to remove.`);
    }

    // Delete it from the database
    db.prepare('DELETE FROM vouches WHERE id = ?').run(latestVouch.id);
    message.reply(`🗑️ **Admin Action:** Successfully deleted the most recent vouch for **${member.user.username}**.`);
  }

  // COMMAND 4: !leaderboard
  if (message.content === '!leaderboard') {
    const rows = db.prepare(`
      SELECT receiver_id, receiver_name, COUNT(*) as count 
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
      .setColor(0xbb86fc)
      .setTimestamp();

    const medals = ["🥇 1st Place", "🥈 2nd Place", "🥉 3rd Place"];
    
    rows.forEach((row, index) => {
      const name = row.receiver_name || `<@${row.receiver_id}>`;
      embed.addFields({
        name: medals[index],
        value: `**${name}** with **${row.count}** vouches!`,
        inline: false
      });
    });

    message.channel.send({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
