'use strict';

const os = require('os');
const pkg = require('../package.json');

const INNER_WIDTH = 74; // largeur interieure de la boite (entre les deux |)

// Couleurs desactivees si la sortie n'est pas un terminal (log redirige vers
// un fichier, PM2, etc.) : evite de polluer les logs avec des codes ANSI bruts.
const COLOR_ENABLED = (!!process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
const CODES = { reset: '0', bold: '1', cyan: '36', magenta: '35', green: '32', blue: '34', yellow: '33', white: '37', red: '31' };
function c(text, color) {
  if (!COLOR_ENABLED) return text;
  return `\x1b[${CODES[color]}m${text}\x1b[${CODES.reset}m`;
}
function bold(text) {
  if (!COLOR_ENABLED) return text;
  return `\x1b[${CODES.bold}m${text}\x1b[${CODES.reset}m`;
}
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
function visibleLength(str) {
  return stripAnsi(str).length;
}
function padVisible(str, target) {
  const pad = target - visibleLength(str);
  return pad > 0 ? str + ' '.repeat(pad) : str;
}

function localNetworkAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push({ iface: name, address: net.address });
    }
  }
  return addresses;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} Mo`;
}
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 1 ? '<1s' : `${s}s`;
}

// Decoupe une valeur trop longue en plusieurs lignes qui tiennent dans la
// boite, en coupant de preference aux espaces/virgules (jamais au milieu
// d'un mot si on peut l'eviter).
function wrapValue(value, maxWidth) {
  if (visibleLength(value) <= maxWidth) return [value];
  const tokens = value.split(/(?<=[, /])/); // garde le separateur avec le morceau precedent (URLs incluses)
  const lines = [];
  let current = '';
  for (let token of tokens) {
    // Un seul "mot" (ex: chemin sans espace) plus long que la largeur dispo :
    // coupe brute, sinon la ligne deborderait indefiniment de la boite.
    while (visibleLength(token) > maxWidth) {
      if (current) { lines.push(current.trimEnd()); current = ''; }
      lines.push(token.slice(0, maxWidth));
      token = token.slice(maxWidth);
    }
    if (visibleLength(current + token) > maxWidth && current) {
      lines.push(current.trimEnd());
      current = token.trimStart();
    } else {
      current += token;
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines;
}

function border() {
  return c(`+${'='.repeat(INNER_WIDTH)}+`, 'cyan');
}

// label/value colores independamment (comme demande), valeur repartie sur
// plusieurs lignes si besoin, avec la colonne ":" alignee entre toutes les
// lignes malgre les emoji de largeur variable.
function row(label, value, labelColor, valueColor) {
  const LABEL_WIDTH = 44;
  // Un nom d'interface reseau Windows peut etre tres long (ex: "vEthernet
  // (WSL (Hyper-V firewall))") : tronque plutot que de faire deborder la boite.
  const truncatedLabel = visibleLength(label) > LABEL_WIDTH
    ? label.slice(0, LABEL_WIDTH - 1) + '…'
    : label;
  const paddedLabel = padVisible(truncatedLabel, LABEL_WIDTH);
  const valueMaxWidth = INNER_WIDTH - 2 - LABEL_WIDTH - 3; // "  " + label + " : "
  const valueLines = wrapValue(String(value), valueMaxWidth);
  const out = [];
  valueLines.forEach((line, i) => {
    const left = i === 0 ? `  ${c(paddedLabel, labelColor)} : ` : `  ${' '.repeat(LABEL_WIDTH)}   `;
    const content = padVisible(left + c(line, valueColor), INNER_WIDTH);
    out.push(`${c('|', 'cyan')}${content}${c('|', 'cyan')}`);
  });
  return out;
}

function printBanner({ port, startedAt, io, adminCredentials }) {
  const nets = localNetworkAddresses();
  const mem = process.memoryUsage();
  const pushConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const nodeEnv = process.env.NODE_ENV || 'development';
  let packMeta = [];
  try { packMeta = require('./cardManager').getPackMeta(); } catch (e) { /* pas bloquant pour la banniere */ }

  const rows = [
    ['📦 Version', `${pkg.name}@${pkg.version}`, 'blue', 'white'],
    ['🌐 Local', `http://localhost:${port}`, 'green', 'green'],
    ...nets.map((n) => [`📶 Reseau - ${n.iface}`, `http://${n.address}:${port}`, 'green', 'green']),
    ['🔌 Port', String(port), 'yellow', 'yellow'],
    ['🖥️  Hostname', os.hostname(), 'blue', 'white'],
    ['💻 Plateforme', `${os.platform()} ${os.release()} (${os.arch()})`, 'blue', 'white'],
    ['🟢 Node.js', process.version, 'green', 'green'],
    ['🆔 PID', String(process.pid), 'magenta', 'white'],
    ['📂 Dossier', process.cwd(), 'blue', 'white'],
    ['⚙️  Environnement', nodeEnv, 'yellow', 'yellow'],
    ['🧠 CPU', `${os.cpus().length} coeurs`, 'green', 'white'],
    ['💾 RAM systeme', `${formatBytes(os.freemem())} libres / ${formatBytes(os.totalmem())}`, 'green', 'white'],
    ['📊 RAM process - RSS', formatBytes(mem.rss), 'green', 'white'],
    ['🔗 Connexion admin - local', `http://localhost:${port}/admin.html`, 'magenta', 'yellow'],
    ...nets.map((n) => [`🔗 Connexion admin - ${n.iface}`, `http://${n.address}:${port}/admin.html`, 'magenta', 'yellow']),
    ...(adminCredentials && adminCredentials.email
      ? [
          ['👤 Admin - email', adminCredentials.email, 'magenta', 'yellow'],
          ['🔑 Admin - mot de passe', adminCredentials.password
            ? `${adminCredentials.password}${adminCredentials.generated ? '  (genere, voir .env)' : ''}`
            : 'deja hashe (voir ADMIN_PASSWORD_HASH dans .env)', 'magenta', adminCredentials.password ? 'red' : 'white'],
        ]
      : [['🛠️  Panel admin', 'NON configure (voir .env.example)', 'magenta', 'yellow']]),
    ['🔔 Notifications push', pushConfigured ? 'configurees' : 'desactivees (VAPID absent)', 'green', 'green'],
    ...(packMeta.length
      ? packMeta.map((p) => [`🃏 Pack "${p.id}"`, `${p.count} carte${p.count > 1 ? 's' : ''}`, 'magenta', 'white'])
      : [['🃏 Packs de cartes', 'aucun charge', 'magenta', 'white']]),
    ['🔁 Socket.IO ping', `interval ${io.opts.pingInterval}ms / timeout ${io.opts.pingTimeout}ms`, 'blue', 'white'],
    ['🗄️  Base de donnees', 'data/app.db (SQLite)', 'blue', 'white'],
    ['⏱️  Demarre en', formatDuration(Date.now() - startedAt), 'yellow', 'green'],
    ['🕒 Heure de demarrage', new Date(startedAt).toLocaleString('fr-FR'), 'blue', 'white'],
  ];

  const title = `${bold(c('CA VA MAL FINIR', 'magenta'))} - ${c('SERVEUR PRET', 'green')}`;
  const titlePadTotal = INNER_WIDTH - visibleLength(title);
  const titleLeft = Math.floor(titlePadTotal / 2);
  const titleRight = titlePadTotal - titleLeft;
  const titleLine = `${c('|', 'cyan')}${' '.repeat(titleLeft)}${title}${' '.repeat(titleRight)}${c('|', 'cyan')}`;

  const lines = [border(), titleLine, border()];
  for (const [label, value, labelColor, valueColor] of rows) {
    lines.push(...row(label, value, labelColor, valueColor));
  }
  lines.push(border());

  console.log('');
  for (const l of lines) console.log(l);
  console.log('');
}

module.exports = { printBanner };
