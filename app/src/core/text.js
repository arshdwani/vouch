// Text utilities shared by retrieval, drafting and expert routing. Deterministic, no dependencies.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', reg: '®', copy: '©', trade: '™', deg: '°', euro: '€', pound: '£' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const escapeXml = (s) =>
  String(s)
    // Characters XML 1.0 cannot carry at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Questionnaire boilerplate and plain English: never a reason to match a passage.
const STOP = new Set(
  `a an the and or nor but if then else of for to in on at by with from into onto as is are was were be been being am
  do does did done doing have has had having can could would should shall will may might must it its this that these
  those there their them they we our ours us you your yours i me my he she his her him which what who whom whose how
  when where why whether any all each every some such other others than so too very also only just not no yes n/a na
  per via e.g i.e etc eg ie please describe explain provide detail details list outline indicate confirm state specify
  organization organisation organizations company companies vendor vendors supplier suppliers provider providers
  service services solution solutions product products customer customers client clients ensure ensures ensured
  maintain maintains maintained establish established implement implemented place applicable including include
  includes included document documented documentation formal formally process processes procedure procedures
  policy policies program programme practice practices appropriate adequate relevant regard regarding related
  within across about over under between both either neither one two use used using perform performed
  require required requires requirement requirements standard standards often frequently frequency quickly much
  ever long timeframe regularly currently given new share reach reaches operate operates run runs take taken make
  makes need needs every before after least able engage engages engaged engaging handle handles handled handling
  happen happens once everything anything see behalf whatever choose chooses select pick decide through possible
  possibly set up specific only`.split(/\s+/),
);

// Security thesaurus: phrases and synonyms folded into one concept token. Documents keep their own words next to
// the token; questions are reduced to the token, so "second factor", "2FA" and "multi-factor" all meet at "mfa".
// Order matters: longer, more specific phrases first.
const PHRASES = [
  // Authentication and access
  [/\b(multi[\s-]?factor|two[\s-]?factor|2[\s-]?fa|mfa|(2|two)[\s-]?step( verification)?|second factor|one[\s-]time (passwords?|codes?)|otp|authenticator apps?|security keys?|fido2|hardware tokens?)\b/g, 'mfa'],
  [/\b(single[\s-]?sign[\s-]?on|sso|identity providers?|idp|okta|azure ad|entra( id)?|onelogin|saml( 2\.0)?|oidc|openid connect|federated (login|identity|authentication))\b/g, 'sso'],
  [/\b(privileged (accounts?|users?|access)|admin(istrator)? accounts?|administrators|admins|root access|superusers?)\b/g, 'privileged'],
  [/\b(standing access|permanent access|just[\s-]in[\s-]time|jit access)\b/g, 'jit'],
  [/\b(recertif\w*|entitlement reviews?|(user )?access reviews?|review (their |user |the )?(team's |teams' )?access)\b/g, 'accessreview'],
  [/\b((user|system|logical) )?access (rights|permissions|privileges|entitlements)\b|\bentitlements?\b/g, 'access'],
  [/\b(departs?|departing|departure|leavers?|leaves the company|leaves brightlake|someone leaves|offboard\w*|last working day|exits? the company)\b/g, 'offboard'],
  [/\b(accounts? (are |is )?(disabled|deactivated|deprovisioned|removed|revoked)|deprovision\w*|access is revoked|revoke\w* access)\b/g, 'revoke'],
  [/\b(multi[\s-]?tenan\w*|tenant isolation|tenants?|segregat\w*|logically (separated|isolated)|isolated from other customers)\b/g, 'tenantisolation'],
  [/\b(least[\s-]privilege)\b/g, 'leastprivilege'],
  [/\b(role[\s-]based access( control)?|rbac)\b/g, 'rbac'],
  // Encryption
  [/\b(at[\s-]rest|while (it is )?stored|stored on (your|our) servers|data in storage)\b/g, 'atrest'],
  [/\b(in[\s-]transit|over (public )?networks?|over the (internet|wire)|between (our|their) users and)\b/g, 'intransit'],
  [/\b(tls|ssl|https|protocol versions?)\b/g, 'tls'],
  [/\baes[\s-]?(128|256)?\b|\bciphers?\b/g, 'aes'],
  [/\b(byok|bring your own (encryption )?keys?|customer[\s-]managed keys?|(our|their) own key material|own encryption keys)\b/g, 'byok'],
  [/\b(key management( service| system)?|kms|hsm|hardware security modules?|cryptographic keys?|encryption keys?|key material)\b/g, 'kms'],
  [/\b(rotat\w*|replaced|renewed)\b/g, 'rotate'],
  // Data lifecycle
  [/\b(subscription ends|contract ends|end of (the |our )?(contract|subscription)|after (we leave|termination)|terminat\w* (of )?(the |our )?(contract|agreement|subscription)|contract is terminated|we cancel)\b/g, 'contractend'],
  [/\b(purg\w*|destroy\w*|dispos\w*|eras\w*|delet\w*)\b/g, 'delete'],
  [/\b(download a (full )?copy|export\w*|data portability|get (our|all) data back)\b/g, 'export'],
  [/\b(audit (trails?|logs?)|security logs?)\b/g, 'auditlog'],
  [/\b(geographic region|data residency|data locality|hosting regions?|region where|hosted in the eu|where (our|their|the) data (is )?(stored|kept|located))\b/g, 'residency'],
  // Incidents and continuity
  [/\b(compromised|breach\w*|data leaks?)\b/g, 'breach'],
  [/\b(tell us|let us know|inform (us|customers)|notif\w*|notice|warn us)\b/g, 'notify'],
  [/\b(security (events?|incidents?)|incident (handling|management|response))\b/g, 'incident'],
  [/\b(rehears\w*|drills?|tabletop( exercises?)?)\b/g, 'tabletop'],
  [/\b(24\/7|24x7|around the clock|round the clock|outside (of )?business hours|after hours|on[\s-]call)\b/g, 'oncall'],
  [/\b(rpo|recovery point objective|(maximum )?(tolerable )?data loss)\b/g, 'rpo'],
  [/\b(rto|recovery time objective|downtime)\b/g, 'rto'],
  [/\b(availability zones?|loss of (a |one |a single )?(zone|data cent(er|re))|survive the loss)\b/g, 'redundancy'],
  [/\b(disaster recovery|dr plan|drp)\b/g, 'disasterrecovery'],
  [/\b(business continuity|bcp)\b/g, 'bcp'],
  [/\b(restor\w*)\b/g, 'restore'],
  // Third parties
  [/\b(sub[\s-]?processors?|other companies (that )?handle|vendors? that process\w*|sub[\s-]?contractors?|service providers that process)\b/g, 'subprocessor'],
  [/\b(third[\s-]?part(y|ies)|fourth[\s-]?part(y|ies)|outside firms?|independent (third[\s-]party )?firms?)\b/g, 'thirdparty'],
  [/\b(data (protection|processing) (terms|agreements?|addendum)|dpas?)\b/g, 'dpa'],
  // Development and vulnerabilities
  [/\b(code reviews?|peer[\s-]review\w*|second (developer|engineer)|four[\s-]eyes|pull request reviews?)\b/g, 'codereview'],
  [/\b(static (application security testing|analysis|code analysis)|sast|scan\w* code|security flaws)\b/g, 'sast'],
  [/\b(vulnerable (libraries|dependencies)|dependency (vulnerability )?scann\w*|software composition analysis)\b/g, 'depscan'],
  [/\b(ci\/cd|ci|continuous integration|build pipelines?)\b/g, 'cicd'],
  [/\b(live customer data|production (customer )?data|real customer data)\b/g, 'proddata'],
  [/\b(test (systems|environments?)|staging|development (or test )?environments?|non[\s-]production)\b/g, 'testenv'],
  [/\b(pen(etration)?[\s-]?test(s|ing|ed)?|pentest(s|ing)?|break into|hack into|ethical hack\w*|red team\w*)\b/g, 'pentest'],
  [/\b(vulnerability disclosure|responsible disclosure|bug bounty|report a security bug|security researchers?|researchers can report)\b/g, 'vdp'],
  [/\b(vulnerability scan(s|ning)?|vuln scan(s|ning)?)\b/g, 'vulnscan'],
  [/\b(weakness\w*|vulnerabilit\w*)\b/g, 'vulnerability'],
  [/\b(patch\w*|remediat\w*|fix(es|ed)?)\b/g, 'patch'],
  [/\b(sdlc|software development life[\s-]?cycle|secure development)\b/g, 'sdlc'],
  // People and places
  [/\b(background (checks?|screening|verification|investigations?)|screened|screening|vetting|vetted)\b/g, 'backgroundcheck'],
  [/\b(phishing (training|tests?|simulations?|exercises?)|phishing)\b/g, 'phishing'],
  [/\b(security awareness)\b/g, 'awareness'],
  [/\b(physically enter|physical (access|security)|premises|buildings?|badge access|biometric|guards|cctv|escorted)\b/g, 'physicalaccess'],
  [/\b(data center|datacenter|data centre)s?\b/g, 'datacenter'],
  [/\b(sign[\s-]off|signs off|approv\w*)\b/g, 'approve'],
  [/\b(leadership|senior management|executive management|by management|executives?|the board|cto)\b/g, 'leadership'],
  // Other common terms
  [/\b(byod|bring your own device)\b/g, 'byod'],
  [/\bsoc[\s-]?2\b/g, 'soc2'],
  [/\biso[\s/-]?(iec[\s-]?)?27001\b/g, 'iso27001'],
  [/\b(endpoint detection( and response)?|edr)\b/g, 'edr'],
  [/\b(data loss prevention|dlp)\b/g, 'dlp'],
  [/\b(security information and event management|siem)\b/g, 'siem'],
  [/\b(acceptable use)\b/g, 'acceptableuse'],
];

// Stems that should meet: "retain"/"retention", "recovery"/"recover", "e-mail"/"email".
const CANON = { retain: 'retent', recovery: 'recover', recoverabl: 'recover', mail: 'email', encrypt: 'encrypt', cryptographic: 'encrypt', cipher: 'encrypt', breach: 'breach', storage: 'store', stor: 'store', backed: 'backup', onboard: 'onboard', offboard: 'offboard', terminat: 'offboard', departure: 'offboard', leaver: 'offboard', logg: 'log', audit: 'audit', insur: 'insur', notic: 'notify', notificat: 'notify', stored: 'store', host: 'host', busi: 'business', employe: 'employ', hire: 'employ', hir: 'employ', keep: 'retent', kept: 'retent', record: 'data' };

const SUFFIXES = [
  ['ational', 'ate'], ['izations', 'ize'], ['ization', 'ize'], ['isation', 'ize'], ['ations', 'ate'], ['ation', 'ate'],
  ['ments', ''], ['ment', ''], ['ness', ''], ['ities', ''], ['ity', ''], ['ically', 'ic'], ['ally', 'al'],
  ['ings', ''], ['ing', ''], ['ions', ''], ['ion', ''], ['ied', 'y'], ['ies', 'y'], ['ly', ''], ['ed', ''],
];

/** A small suffix-stripping stemmer, tuned for policy and questionnaire vocabulary. */
export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return CANON[w] || w;
  let s = w;
  let stripped = false;
  for (const [suf, rep] of SUFFIXES) {
    if (s.endsWith(suf) && s.length - suf.length + rep.length >= 3) {
      s = s.slice(0, -suf.length) + rep;
      stripped = true;
      break;
    }
  }
  if (!stripped) {
    if (/(ss|sh|ch|x|z)es$/.test(s)) s = s.slice(0, -2);
    else if (s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  }
  if (stripped && /([^aeiouysz])\1$/.test(s)) s = s.slice(0, -1); // logging -> logg -> log, controlled -> control
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return CANON[s] || s;
}

/**
 * Lower-cases, folds known phrases and splits into words. Documents keep the phrase's own words next to the
 * canonical token; questions (`replace`) keep only the token, so "pen test" doesn't hinge on the word "pen".
 */
export function words(text, { replace = false } = {}) {
  let t = ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'")} `;
  for (const [re, canon] of PHRASES) t = t.replace(re, (m) => (replace ? ` ${canon} ` : `${m} ${canon} `));
  return t.split(/[^a-z0-9/]+/).flatMap((w) => w.split('/')).filter(Boolean);
}

export const isStop = (w) => STOP.has(w) || w.length < 2 || /^\d+$/.test(w);

/** Content tokens (stemmed, stopwords dropped). */
export function tokens(text) {
  const out = [];
  for (const w of words(text)) {
    if (STOP.has(w) || w.length < 2 || /^\d+$/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Unique query terms in order, each with the first word that produced it (for readable reasons). */
export function queryTerms(text) {
  const seen = new Map();
  for (const w of words(text, { replace: true })) {
    if (STOP.has(w) || w.length < 2 || /^\d+$/.test(w)) continue;
    const s = stem(w);
    if (!seen.has(s)) seen.set(s, w);
  }
  return [...seen].map(([term, word]) => ({ term, word }));
}

const ABBR = /\b(e\.g|i\.e|etc|vs|approx|incl|no|fig|inc|ltd|dept)\.\s/gi;

/** Splits a passage into sentences, keeping "e.g." and friends inside their sentence. */
export function sentences(text) {
  const guarded = String(text).replace(ABBR, (m) => m.replace('.', '․'));
  return guarded
    .split(/\n+|(?<=[.!?;:])\s+(?=[A-Z0-9"“(•\-–])/)
    .map((s) => s.replace(/․/g, '.').replace(/^[•\-–*]\s*/, '').trim())
    .filter((s) => s.length > 2);
}

/**
 * Confluence storage format (XHTML) -> blocks [{ heading, text }]. Headings become block boundaries; paragraphs,
 * list items and table rows each become one line. Macro parameters are dropped; macro bodies are kept.
 */
export function storageToBlocks(xhtml) {
  let s = String(xhtml || '');
  s = s.replace(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi, ' ');
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => t.replace(/</g, '&lt;'));
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, __, t) => `\n§H ${t.replace(/<[^>]+>/g, ' ')}\n`);
  s = s.replace(/<\/(t[dh])>/gi, '; ');
  s = s.replace(/<(br|hr)\b[^>]*\/?>/gi, '\n');
  s = s.replace(/<\/(p|li|tr|div|blockquote|pre|ac:task|ac:rich-text-body|ac:plain-text-body)>/gi, '\n');
  s = s.replace(/<(li)\b[^>]*>/gi, '\n• ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  const blocks = [];
  let heading = '';
  let buf = [];
  const flush = () => {
    if (buf.length) blocks.push({ heading, text: buf.join('\n') });
    buf = [];
  };
  for (const raw of s.split('\n')) {
    const line = raw.replace(/[ \t ]+/g, ' ').replace(/(;\s*)+$/, '').trim();
    if (!line) continue;
    if (line.startsWith('§H ')) {
      flush();
      heading = line.slice(3).trim();
    } else buf.push(line.replace(/^•\s*/, '• '));
  }
  flush();
  return blocks;
}

/** Plain text of an Atlassian Document Format node (Jira comments and descriptions). */
export function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text || '';
  const inner = (node.content || []).map(adfText).join('');
  return /^(paragraph|heading|listItem|blockquote|codeBlock|tableRow)$/.test(node.type) ? `${inner}\n` : inner;
}

export const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t;
};
