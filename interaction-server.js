const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PORT = Number(process.env.PORT) || 3000;
let busy = false;

function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
        return {};
    }
}

function verifyRequest(body, signature, timestamp) {
    const config = readConfig();
    if (!signature || !timestamp || !config.publicKey) return false;
    try {
        return crypto.verify(
            null,
            Buffer.concat([Buffer.from(timestamp), body]),
            Buffer.from(config.publicKey, 'hex'),
            Buffer.from(signature, 'hex')
        );
    } catch (err) {
        return false;
    }
}

function buildPanel() {
    const config = readConfig();
    return {
        embeds: [new EmbedBuilder()
            .setTitle('Roblox Account Generator')
            .setDescription([
                `**Rounds:** ${config.rounds || 1}`,
                `**Prefix:** ${config.prefix || '-'}`,
                `**Concurrency:** ${config.concurrency || 1}`,
                'กดปุ่มด้านล่างเพื่อเริ่มสร้างบัญชี'
            ].join('\n'))
            .setColor(0x5865f2)],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('create_account')
                .setLabel('สร้าง')
                .setStyle(ButtonStyle.Primary)
        )]
    };
}

async function editReply(token, content) {
    const config = readConfig();
    const res = await fetch(
        `https://discord.com/api/v10/webhooks/${config.applicationId}/${token}/messages/@original`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        }
    );
    if (!res.ok) throw new Error(`editReply HTTP ${res.status}`);
}

function runGenerator(token) {
    const config = readConfig();
    busy = true;
    editReply(token, '⏳ กำลังสร้างบัญชี...').catch(() => { });
    const env = Object.assign({}, process.env, {
        AUTO_MODE: 'true',
        AUTO_ROUNDS: String(config.rounds || 1),
        AUTO_PREFIX: String(config.prefix || ''),
        AUTO_CONCURRENCY: String(config.concurrency || 1),
        AUTO_HEADLESS: config.headless === true ? 'Y' : 'N'
    });
    const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
        env,
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('exit', (code) => {
        busy = false;
        const message = code === 0
            ? '✅ สร้างบัญชีเสร็จแล้ว'
            : `❌ เกิดข้อผิดพลาด\n${output.slice(-1500)}`;
        editReply(token, message).catch((err) => console.error(`✖ editReply: ${err.message}`));
    });
}

const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/interactions') {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (!verifyRequest(body, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'])) {
            res.writeHead(401);
            res.end('Unauthorized');
            return;
        }
        let interaction;
        try {
            interaction = JSON.parse(body.toString('utf8'));
        } catch (err) {
            res.writeHead(400);
            res.end('Bad request');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (interaction.type === 1) {
            res.end(JSON.stringify({ type: 1 }));
            return;
        }
        if (interaction.type === 3 && interaction.data && interaction.data.custom_id === 'create_account') {
            res.end(JSON.stringify({ type: 5 }));
            if (busy) {
                editReply(interaction.token, '⚠ กำลังสร้างอยู่ กรุณารอให้เสร็จก่อน').catch(() => { });
            } else {
                runGenerator(interaction.token);
            }
            return;
        }
        res.end(JSON.stringify({ type: 1 }));
    });
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    if (process.argv.includes('--send-panel')) {
        try {
            const config = readConfig();
            const channel = await client.channels.fetch(config.channelId);
            await channel.send(buildPanel());
            console.log('Panel sent');
        } catch (err) {
            console.error(`✖ Send panel: ${err.message}`);
        }
    }
});

server.listen(PORT, () => console.log(`Interaction endpoint listening on http://localhost:${PORT}/interactions`));
client.login(readConfig().botToken).catch((err) => console.error(`✖ Discord login: ${err.message}`));
