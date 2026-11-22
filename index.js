const gradient = require('gradient-string');
const readlineSync = require('readline-sync');
const cluster = require('cluster');
const puppeteer = require('puppeteer');
const generator = require('generate-password');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const SIGNUP_URL = 'https://www.roblox.com/CreateAccount';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const YEARS = ['2003', '2002', '2001', '2000', '1999', '1998', '1997', '1996', '1995', '1994', '1993', '1992', '1991', '1990'];
const MAX_USERNAME_TRIES = 12;
const STEP_TIMEOUT_MS = 45000;
const DEFAULT_MANUAL_TIMEOUT_MS = 180000;

function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function timestamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
        `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
        return {};
    }
}

function makeUsername(prefix) {
    const cleanPrefix = String(prefix || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 12);
    const suffix = generator.generate({ length: 7, numbers: true, uppercase: false });
    return (cleanPrefix + suffix).slice(0, 20);
}

function makePassword(username) {
    let password;
    do {
        password = generator.generate({ length: 16, numbers: true, uppercase: true, symbols: true, strict: true });
    } while (password === username || password.toLowerCase().includes(username.toLowerCase()));
    return password;
}

function ensureDataFiles() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const files = [
        ['accounts.txt', ''],
        ['accounts.csv', '\ufeffround,time,username,password\r\n'],
        ['cookies.txt', ''],
        ['user-pass.txt', '']
    ];
    for (const [name, header] of files) {
        const filePath = path.join(DATA_DIR, name);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, header, 'utf8');
        }
    }
}

async function sendWebhook(entry) {
    const webhook = readConfig().webhook;
    if (!webhook || !/^https:\/\//i.test(webhook)) return;
    const description = [
        `**Round:** ${entry.roundNumber}`,
        `**Time:** ${entry.time}`,
        `**Username:** \`${entry.username}\``,
        `**Password:** \`${entry.password}\``,
        `**Cookie:** ${entry.cookie ? 'saved in data/cookies.txt' : 'not received'}`
    ].join('\n');
    const payload = {
        username: 'Roblox Account Generator',
        embeds: [{ title: 'New Roblox Account', description, color: 0x00b06f }]
    };
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
}

async function sendCookieWebhook(entry) {
    if (!entry.cookie) return;
    const webhook = readConfig().cookieWebhook;
    if (!webhook || !/^https:\/\//i.test(webhook)) return;
    const description = [
        `**Round:** ${entry.roundNumber}`,
        `**Time:** ${entry.time}`,
        `**Username:** \`${entry.username}\``,
        `**Cookie:** \`${entry.cookie}\``
    ].join('\n');
    const payload = {
        username: 'Roblox Cookie Logger',
        embeds: [{ title: 'New Roblox Cookie', description, color: 0xffa500 }]
    };
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`cookie webhook HTTP ${res.status}`);
}

async function sendStartWebhook(options) {
    const webhook = readConfig().startWebhook;
    if (!webhook || !/^https:\/\//i.test(webhook)) return;
    const description = [
        `**Rounds:** ${options.rounds}`,
        `**Prefix:** \`${options.prefix || '-'}\``,
        `**Concurrency:** ${options.concurrency}`,
        `**Headless:** ${options.headless ? 'Yes' : 'No'}`,
        `**Time:** ${options.time}`
    ].join('\n');
    const payload = {
        username: 'Roblox Account Generator',
        embeds: [{ title: 'Create Started', description, color: 0x5865f2 }]
    };
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`start webhook HTTP ${res.status}`);
}

function saveAccount(entry) {
    ensureDataFiles();
    const line = '═'.repeat(46);
    const card =
        `${line}\r\n` +
        ` รอบที่   : ${entry.roundNumber}\r\n` +
        ` เวลา     : ${entry.time}\r\n` +
        ` Username : ${entry.username}\r\n` +
        ` Password : ${entry.password}\r\n` +
        `${line}\r\n\r\n`;
    fs.appendFileSync(path.join(DATA_DIR, 'accounts.txt'), card, 'utf8');

    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    fs.appendFileSync(
        path.join(DATA_DIR, 'accounts.csv'),
        [entry.roundNumber, entry.time, entry.username, entry.password].map(q).join(',') + '\r\n',
        'utf8'
    );
    fs.appendFileSync(path.join(DATA_DIR, 'cookies.txt'), `${entry.cookie || ''}\r\n`, 'utf8');
    fs.appendFileSync(path.join(DATA_DIR, 'user-pass.txt'), `${entry.username}:${entry.password}\r\n`, 'utf8');

    console.log(`✔ Saved: ${entry.username} (${entry.cookie ? 'cookie OK' : 'cookie ไม่มี'})`);
    sendWebhook(entry).catch((err) => console.error(`✖ Webhook: ${err.message}`));
    sendCookieWebhook(entry).catch((err) => console.error(`✖ Cookie Webhook: ${err.message}`));
}

async function fillBirthday(page) {
    const setValue = async (testId, value) => {
        const selector = `[data-testid="${testId}"] select`;
        await page.waitForSelector(selector, { timeout: STEP_TIMEOUT_MS });
        await page.evaluate((selector, value) => {
            const select = document.querySelector(selector);
            if (!select) throw new Error(`ไม่พบ ${selector}`);
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            setter.call(select, value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }, selector, value);
    };
    await setValue('birthday-month', randomItem(MONTHS));
    await setValue('birthday-day', randomItem(DAYS));
    await setValue('birthday-year', randomItem(YEARS));
}

async function hasEnabledSubmit(page) {
    return page.evaluate(() => [...document.querySelectorAll('button[type=submit]')].some(
        (button) => !button.disabled && button.offsetParent !== null && button.innerText.trim().length > 0
    ));
}

async function clickSubmit(page) {
    const clicked = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button[type=submit]')].find(
            (item) => !item.disabled && item.offsetParent !== null && item.innerText.trim().length > 0
        );
        if (!button) return false;
        button.click();
        return true;
    });
    if (!clicked) throw new Error('ไม่พบปุ่มยืนยันที่เปิดใช้งาน');
}

async function usernameStatus(page) {
    return page.evaluate(() => {
        const input = document.getElementById('signup-username');
        if (!input) return { error: true, message: 'ไม่พบช่อง username' };
        if (input.getAttribute('aria-invalid') !== 'true') return { error: false, message: '' };
        const wrapper = input.closest('[data-testid="text-input-wrapper"]') || input.parentElement;
        const message = [...wrapper.querySelectorAll('*')]
            .filter((node) => node.children.length === 0 && node.offsetParent !== null && node.textContent.trim())
            .map((node) => node.textContent.trim())
            .join(' | ')
            .slice(0, 160);
        return { error: true, message: message || 'username ไม่ถูกต้อง' };
    });
}

async function writeUsername(page, username) {
    await page.click('#signup-username');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#signup-username', username, { delay: 25 });
}

async function waitUsernameAccepted(page) {
    const deadline = Date.now() + 12000;
    let errorSince = 0;
    while (Date.now() < deadline) {
        if (await hasEnabledSubmit(page)) return { error: false, message: '' };
        const status = await usernameStatus(page);
        if (status.error) {
            if (!errorSince) errorSince = Date.now();
            else if (Date.now() - errorSince >= 1500) return status;
        } else {
            errorSince = 0;
        }
        await delay(300);
    }
    return { error: true, message: 'username ใช้เวลาตรวจสอบนานเกินไป' };
}

async function waitForSignup(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let captchaNotified = false;
    while (Date.now() < deadline) {
        const cookies = await page.cookies();
        const security = cookies.find((cookie) => cookie.name === '.ROBLOSECURITY');
        if (security) return security.value;
        if (/\/(home|my-account)(\/|$)/.test(page.url())) return '';
        if (!captchaNotified) {
            const hasCaptcha = await page.evaluate(() => !!document.querySelector('#px-captcha, [id*=captchav2]'));
            if (hasCaptcha) {
                console.log('⚠ เจอ CAPTCHA กรุณายืนยันในหน้าต่าง Chrome ที่เปิดอยู่ (สคริปต์จะรอต่อ)');
                captchaNotified = true;
            }
        }
        await delay(1000);
    }
    return null;
}

async function runPuppeteer(roundNumber, prefix, headless, manualTimeoutMs) {
    console.log(`Starting round ${roundNumber}`);
    const browser = await puppeteer.launch({
        headless,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        defaultViewport: { width: 1280, height: 900 }
    });
    try {
        const page = await browser.newPage();
        await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#signup-username', { timeout: STEP_TIMEOUT_MS });
        await fillBirthday(page);
        await page.evaluate(() => {
            const female = document.querySelector('button:has(.icon-regular-head-female)');
            if (female) female.click();
        });

        let username = '';
        let accepted = false;
        for (let attempt = 1; attempt <= MAX_USERNAME_TRIES; attempt++) {
            username = makeUsername(prefix);
            await writeUsername(page, username);
            const status = await waitUsernameAccepted(page);
            if (!status.error) {
                accepted = true;
                break;
            }
            console.log(`Round ${roundNumber}: username "${username}" ใช้ไม่ได้ (${status.message}) ลองใหม่ ${attempt}/${MAX_USERNAME_TRIES}`);
        }
        if (!accepted) throw new Error('หมดรอบลอง username แล้ว');

        const password = makePassword(username);
        await clickSubmit(page);
        await page.waitForSelector('#signup-v2-password', { visible: true, timeout: STEP_TIMEOUT_MS });
        await page.type('#signup-v2-password', password, { delay: 25 });
        await delay(800);
        await clickSubmit(page);

        const cookie = await waitForSignup(page, manualTimeoutMs);
        if (cookie === null) {
            throw new Error(`หมดเวลารอการยืนยันตัวตน (${Math.round(manualTimeoutMs / 1000)} วิ) อาจต้องแก้ CAPTCHA ในหน้าต่าง Chrome`);
        }
        if (!cookie) console.log(`⚠ Round ${roundNumber}: สมัครสำเร็จแต่ไม่พบ cookie .ROBLOSECURITY`);
        console.log(`Round ${roundNumber} completed successfully`);
        return { roundNumber, username, password, cookie, time: timestamp() };
    } finally {
        await browser.close().catch(() => { });
    }
}

async function workerMain() {
    const roundNumber = parseInt(process.env.roundNumber, 10);
    const prefix = process.env.usernameInput || '';
    const headless = process.env.headless === 'true';
    const manualTimeoutMs = parseInt(process.env.manualTimeoutMs, 10) || DEFAULT_MANUAL_TIMEOUT_MS;
    let account;
    try {
        account = await runPuppeteer(roundNumber, prefix, headless, manualTimeoutMs);
    } catch (err) {
        const msg = String((err && err.message) || err);
        if (/Target closed|Session closed|Browser has disconnected/i.test(msg)) {
            console.error(`✖ รอบที่ ${roundNumber}: หน้าต่างเบราว์เซอร์ถูกปิดก่อนสมัครเสร็จ (ข้ามรอบนี้)`);
        } else {
            console.error(`✖ รอบที่ ${roundNumber} ผิดพลาด: ${msg}`);
        }
    }
    if (account && process.send) {
        await new Promise((resolve) => process.send({ type: 'account', data: account }, resolve));
    }
    process.exit(0);
}

const isMaster = cluster.isPrimary !== undefined ? cluster.isPrimary : cluster.isMaster;

if (isMaster) {
    console.clear();
    console.log(gradient('white', 'gray').multiline([
        "DevBy: ZEMONNUB \n",
        "/> Roblox Account Generate v.3 </ \n",
        "GitHub: https://github.com/Teemo4621 \n"
    ].join('\n')));
    console.log(gradient.cristal('DiscordMe ∨ \n'));
    const logo = gradient('orange', 'yellow').multiline([
        "███████╗███████╗███╗░░░███╗░█████╗░███╗░░██╗",
        "╚════██║██╔════╝████╗░████║██╔══██╗████╗░██║",
        "░░███╔═╝█████╗░░██╔████╔██║██║░░██║██╔██╗██║",
        "██╔══╝░░██╔══╝░░██║╚██╔╝██║██║░░██║██║╚████║",
        "███████╗███████╗██║░╚═╝░██║╚█████╔╝██║░╚███║",
        "╚══════╝╚══════╝╚═╝░░░░░╚═╝░╚════╝░╚═╝░░╚══╝",
    ].join('\n'));
    console.log(logo + '\n');

    const config = readConfig();
    const loop = readlineSync.questionInt('Rounds : ');
    const usernameInput = readlineSync.question('Prefix username (e.g., Zemon_): ');
    const concurrencyInput = readlineSync.question('Concurrency (รันพร้อมกันกี่รอบ) [1]: ', { defaultInput: '1' });
    const concurrency = Math.max(1, parseInt(concurrencyInput, 10) || 1);
    const headlessInput = readlineSync.question('Headless? (แนะนำ N เพราะต้องแก้ CAPTCHA) [N]: ', { defaultInput: 'N' });
    const headless = /^y/i.test(headlessInput.trim());
    sendStartWebhook({ rounds: loop, prefix: usernameInput, concurrency, headless, time: timestamp() })
        .catch((err) => console.error(`✖ Start Webhook: ${err.message}`));
    const manualTimeoutMs = parseInt(config.manualTimeoutMs, 10) || DEFAULT_MANUAL_TIMEOUT_MS;

    let nextRound = 1;
    let active = 0;
    let finished = 0;

    const spawnNext = () => {
        while (active < concurrency && nextRound <= loop) {
            const roundNumber = nextRound++;
            active++;
            cluster.fork({
                roundNumber: String(roundNumber),
                usernameInput,
                headless: String(headless),
                manualTimeoutMs: String(manualTimeoutMs)
            });
        }
    };

    cluster.on('message', (worker, message) => {
        if (!message || message.type !== 'account') return;
        try {
            saveAccount(message.data);
        } catch (err) {
            console.error(`✖ บันทึกข้อมูลไม่สำเร็จ: ${err.message}`);
        }
    });

    cluster.on('exit', (worker, code, signal) => {
        active--;
        finished++;
        console.log(`Worker ${worker.process.pid} finished with code ${code}`);
        if (finished === loop) {
            console.log(`✔ เสร็จทั้งหมด ${loop} รอบ ไฟล์อยู่ในโฟลเดอร์ data/`);
        } else {
            spawnNext();
        }
    });

    spawnNext();
} else {
    workerMain();
}
