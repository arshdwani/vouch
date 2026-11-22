// Sample content for "Load sample": ten security policy pages for a fictional SaaS company (Brightlake) and a
// 40-question vendor security questionnaire from a fictional bank (Halden Bank). All text is original.
// Five questions have no policy on purpose, each owned by a different part of the demo site (insurance: HR/Legal;
// VPN and email: IT Support; onboarding: Employee Onboarding; compliance audit: Marketing Software Development), so
// expert routing finds different people for real reasons.

const h = (t) => `<h2>${t}</h2>`;
const p = (t) => `<p>${t}</p>`;
const ul = (...items) => `<ul>${items.map((i) => `<li><p>${i}</p></li>`).join('')}</ul>`;

export const SAMPLE_PARENT = 'Brightlake security policies (Vouch sample)';
// Prefix for sample page titles, so they never collide with (or get mistaken for) a site's own pages.
export const SAMPLE_PREFIX = 'Brightlake sample – ';

export const SAMPLE_PAGES = [
  {
    title: 'Encryption Standard',
    body: [
      p('This standard defines how Brightlake protects customer data with encryption. It applies to every production system and every company laptop. Owner: Security team. Reviewed annually.'),
      h('Data at rest'),
      p('All customer data at rest is encrypted with AES-256, including databases, object storage, search indexes and backups. Encryption at rest is enabled by default and cannot be turned off by engineers.'),
      h('Data in transit'),
      p('All data in transit over public networks is encrypted with TLS 1.2 or higher; TLS 1.0 and 1.1 are disabled. Internal service-to-service traffic uses mutual TLS. HSTS is enabled on all customer-facing domains.'),
      h('Key management'),
      p('Encryption keys are managed in AWS Key Management Service (KMS), backed by FIPS 140-2 validated hardware security modules. Keys are rotated automatically every 12 months, and access to key administration is limited to two named Security engineers.'),
      p('Enterprise customers can bring their own customer-managed keys (BYOK); revoking the key makes their data unreadable within 15 minutes.'),
      h('Endpoints'),
      p('Company laptops use full-disk encryption (FileVault or BitLocker), enforced and verified by our device management tooling before a laptop can reach internal systems.'),
    ].join(''),
  },
  {
    title: 'Access Control and SSO Policy',
    body: [
      p('Access to Brightlake systems follows least privilege: people get the access their role needs and nothing more. Access is granted through role-based access control (RBAC) groups, never to individuals directly.'),
      h('Tenant isolation'),
      p('Each customer is a separate tenant. Customer data is logically separated by tenant ID in every database table and search index, and every request is checked against the tenant of the signed-in user before data is returned.'),
      h('Workforce authentication'),
      p('Employees sign in to all internal and production systems through single sign-on (SSO) with our central identity provider using SAML 2.0 or OpenID Connect. Multi-factor authentication (MFA) is required for every employee and contractor; administrators must use phishing-resistant security keys (FIDO2).'),
      p('Passwords must be at least 14 characters and are checked against known breached passwords. Shared accounts are prohibited.'),
      h('Privileged access'),
      p('Production access is granted just in time for a maximum of 8 hours, requires an approved ticket, and every session is logged.'),
      h('Access reviews'),
      p('Managers review their team\'s access every quarter; access that is no longer needed is removed within five business days of the review.'),
      h('Joiners, movers and leavers'),
      p('When someone leaves Brightlake, all access is revoked within 24 hours of their last working day, triggered automatically by the HR system.'),
      h('Customer SSO'),
      p('Customers on Business and Enterprise plans can enforce SAML 2.0 single sign-on and SCIM user provisioning for their own users of the Brightlake platform.'),
    ].join(''),
  },
  {
    title: 'Data Retention and Deletion Policy',
    body: [
      p('Brightlake keeps customer data only for as long as it is needed to provide the service.'),
      h('Retention'),
      p('Customer data is retained for the duration of the customer contract. Application logs are retained for 12 months; security audit logs are retained for 3 years.'),
      h('Deletion after termination'),
      p('When a contract ends, customer data is deleted from production systems within 30 days. Backups containing the data expire within a further 35 days, after which the data cannot be recovered. A certificate of deletion is available on request.'),
      h('Export'),
      p('Customers can export all of their data at any time in CSV or JSON format from the admin console, including during the 30 days after termination.'),
    ].join(''),
  },
  {
    title: 'Incident Response Plan',
    body: [
      p('This plan describes how Brightlake detects, responds to and learns from security incidents.'),
      h('Detection and on-call'),
      p('Security alerts from our SIEM and cloud monitoring are triaged 24/7 by an on-call security engineer, with a 15-minute response target for critical alerts.'),
      h('Severity and escalation'),
      p('Incidents are classified as SEV1 to SEV4. A SEV1 incident is escalated to the Head of Security and the CTO immediately, and an incident commander is appointed.'),
      h('Customer notification'),
      p('If we confirm a security breach affecting customer data, we notify affected customers without undue delay and in any case within 48 hours of confirmation, with the facts known so far and the actions we are taking.'),
      h('Testing and review'),
      p('The incident response plan is tested every year with a tabletop exercise that includes engineering, legal and support. Every SEV1 and SEV2 incident gets a blameless post-incident review within ten business days.'),
    ].join(''),
  },
  {
    title: 'Business Continuity and Disaster Recovery Plan',
    body: [
      p('Brightlake maintains a business continuity plan (BCP) and a disaster recovery (DR) plan for the platform. Both are reviewed and approved annually.'),
      h('Architecture'),
      p('The platform runs across three availability zones in each hosting region, so the loss of one zone does not interrupt the service.'),
      h('Recovery objectives'),
      p('Our recovery time objective (RTO) is 4 hours and our recovery point objective (RPO) is 1 hour for the production platform.'),
      h('Backups'),
      p('Databases are backed up continuously with point-in-time recovery, and full backups are taken daily. Backups are encrypted and stored in a separate region.'),
      h('Testing'),
      p('Backup restores are tested every quarter. A full disaster recovery failover test is run once a year and the results are reported to leadership.'),
    ].join(''),
  },
  {
    title: 'Subprocessor Management',
    body: [
      p('Brightlake uses a small number of subprocessors to deliver the service. Each one is assessed before use and reviewed every year.'),
      h('Current subprocessors'),
      p('The current list of subprocessors, with their purpose and location, is published on our trust page: Amazon Web Services (hosting, EU and US regions), Stripe (billing) and Zendesk (support tickets).'),
      h('Changes'),
      p('We give customers at least 30 days\' notice by email before adding or replacing a subprocessor, and customers may object to the change.'),
      h('Contracts and reviews'),
      p('Every subprocessor signs a data processing agreement (DPA) with security and confidentiality obligations at least as strict as ours. Their security is reviewed annually.'),
      h('Hosting regions'),
      p('Customer data is hosted in the EU (Frankfurt) or the US (Oregon), depending on where the customer\'s account was created.'),
    ].join(''),
  },
  {
    title: 'Secure Development Lifecycle',
    body: [
      p('Security is built into every stage of Brightlake\'s secure development lifecycle (SDLC).'),
      h('Code review and change management'),
      p('Every code change is peer reviewed and approved by a second engineer before it is merged, and production deployments go through our CI/CD pipeline only. Emergency changes are reviewed after the fact within one business day.'),
      h('Automated testing'),
      p('Our CI pipeline runs static application security testing (SAST), dependency vulnerability scanning and secret scanning on every pull request; builds with critical findings are blocked.'),
      h('Training'),
      p('Engineers complete secure coding training covering the OWASP Top 10 when they join and every year after that.'),
      h('Environments'),
      p('Development, staging and production environments are separated. Production customer data is never copied into development or test environments; tests use synthetic data.'),
    ].join(''),
  },
  {
    title: 'Vulnerability Management Policy',
    body: [
      p('Brightlake finds and fixes vulnerabilities before attackers can use them.'),
      h('Scanning'),
      p('Infrastructure, container images and dependencies are scanned for vulnerabilities continuously, and external-facing systems are scanned weekly.'),
      h('Remediation timelines'),
      p('Vulnerabilities are patched within these timelines from discovery: critical within 7 days, high within 30 days, medium within 90 days.'),
      h('Penetration testing'),
      p('An independent third-party firm performs a penetration test of the Brightlake platform at least once a year and after major releases. An executive summary of the latest report is available to customers under NDA.'),
      h('Responsible disclosure'),
      p('We run a vulnerability disclosure program: researchers can report issues to security@brightlake.example, and we acknowledge reports within two business days.'),
    ].join(''),
  },
  {
    title: 'HR Security Policy',
    body: [
      p('People are part of Brightlake\'s security. This policy covers hiring, training and leaving.'),
      h('Before employment'),
      p('All employees and contractors pass a background check before they start, including identity, employment history and, where the law allows, criminal records.'),
      p('Everyone signs a confidentiality agreement as part of their employment contract.'),
      h('Training'),
      p('Security awareness training is completed by every employee during onboarding and annually after that. Phishing simulations run every quarter.'),
      h('Disciplinary process'),
      p('Breaches of security policy are handled through the formal disciplinary process.'),
    ].join(''),
  },
  {
    title: 'Physical Security Policy',
    body: [
      p('Brightlake does not operate its own data centers. Production systems are hosted in Amazon Web Services data centers, which are independently audited and protected by guards, biometric access control, CCTV and environmental controls.'),
      h('Offices'),
      p('Brightlake offices use badge access for staff, visitors sign in and are escorted at all times, and entrances are covered by CCTV. A clear desk rule applies at the end of each day.'),
      h('Equipment'),
      p('Laptops are tracked in our asset inventory and are wiped remotely if lost or stolen.'),
    ].join(''),
  },
];

// Approved answers seeded into the answer library, so the library path is exercised too.
export const SAMPLE_LIBRARY = [
  {
    question: 'Do you have a dedicated information security team?',
    text: 'Brightlake has a dedicated Security team of six people led by the Head of Security, who reports to the CTO and briefs the board every quarter.',
    short: 'Yes',
  },
  {
    question: 'Are your information security policies reviewed and approved by management at least annually?',
    text: 'All information security policies are reviewed every year by the Security team and approved by the CTO; changes are announced to all staff.',
    short: 'Yes',
  },
  {
    question: 'Do you carry professional indemnity insurance?',
    text: 'Brightlake holds professional indemnity insurance of USD 5 million per claim.',
    short: 'Yes',
  },
];

// [Ref, Domain, Question]. Written in the usual vendor-assessment style; not taken from any licensed questionnaire.
export const SAMPLE_QUESTIONS = [
  ['GOV-01', 'Governance', 'Does your organization have a dedicated information security team or function?'],
  ['GOV-02', 'Governance', 'Are information security policies reviewed and approved by senior management at least annually?'],
  ['ENC-01', 'Encryption', 'Is customer data encrypted at rest? Please state the algorithm and key length.'],
  ['ENC-02', 'Encryption', 'Is data encrypted in transit over public networks, and which TLS versions are supported?'],
  ['ENC-03', 'Encryption', 'How are encryption keys managed, and how often are they rotated?'],
  ['ENC-04', 'Encryption', 'Can customers use their own encryption keys (BYOK / customer-managed keys)?'],
  ['IAM-01', 'Access control', 'Do employees authenticate to internal systems through single sign-on (SSO)?'],
  ['IAM-02', 'Access control', 'Is multi-factor authentication required for all employees, including administrators?'],
  ['IAM-03', 'Access control', 'How frequently are user access rights reviewed?'],
  ['IAM-04', 'Access control', 'How quickly is access revoked when an employee leaves the company?'],
  ['IAM-05', 'Access control', 'Does the platform support SAML-based SSO for customer users?'],
  ['RET-01', 'Data retention', 'How long is customer data retained after the contract is terminated?'],
  ['RET-02', 'Data retention', 'Is customer data deleted from backups, and within what timeframe?'],
  ['RET-03', 'Data retention', 'Can customers export their data, and in which formats?'],
  ['INC-01', 'Incident response', 'Do you have a documented incident response plan?'],
  ['INC-02', 'Incident response', 'Within what timeframe will you notify customers of a security breach affecting their data?'],
  ['INC-03', 'Incident response', 'How often is the incident response plan tested?'],
  ['INC-04', 'Incident response', 'Are security alerts monitored 24/7?'],
  ['BCP-01', 'Business continuity', 'Do you maintain a business continuity and disaster recovery plan?'],
  ['BCP-02', 'Business continuity', 'What are your RTO and RPO for the production service?'],
  ['BCP-03', 'Business continuity', 'How often are backups taken, and are restores tested?'],
  ['SUB-01', 'Third parties', 'Do you publish a list of the subprocessors that process customer data?'],
  ['SUB-02', 'Third parties', 'Will you notify customers before engaging a new subprocessor? How much notice is given?'],
  ['SDL-01', 'Secure development', 'Is every code change peer reviewed before it reaches production?'],
  ['SDL-02', 'Secure development', 'Do you run static analysis (SAST) and dependency scanning in your build pipeline?'],
  ['SDL-03', 'Secure development', 'Is production customer data ever used in development or test environments?'],
  ['VUL-01', 'Vulnerability management', 'How often are your systems scanned for vulnerabilities?'],
  ['VUL-02', 'Vulnerability management', 'What are your patching timelines for critical and high severity vulnerabilities?'],
  ['VUL-03', 'Vulnerability management', 'Is an independent penetration test performed at least annually? Can you share the results?'],
  ['VUL-04', 'Vulnerability management', 'Do you operate a vulnerability disclosure or bug reporting program?'],
  ['HRS-01', 'Human resources', 'Are background checks performed on employees before hire?'],
  ['HRS-02', 'Human resources', 'Do all employees complete security awareness training, and how often?'],
  ['PHY-01', 'Physical security', 'Describe the physical security controls of the data centers that host customer data.'],
  ['PHY-02', 'Physical security', 'How is access to your offices controlled?'],
  ['RES-01', 'Data residency', 'Can customers choose the geographic region where their data is stored?'],
  ['GAP-01', 'Legal', 'Do you maintain cyber liability insurance? Please state the coverage limit.'],
  ['GAP-02', 'Remote access', 'Is remote access to internal systems only possible through the company VPN? Which VPN client is used?'],
  ['GAP-03', 'Human resources', 'Do you use a role-specific onboarding request and checklist to set up new joiners?'],
  ['GAP-04', 'Compliance', 'When was your last external compliance audit, and can you share the audit report?'],
  ['GAP-05', 'Email security', 'Do you enforce SPF, DKIM and DMARC on your corporate email domains?'],
];

// The questions the sample is designed to leave without a confident policy answer.
export const SAMPLE_GAPS = ['GAP-01', 'GAP-02', 'GAP-03', 'GAP-04', 'GAP-05'];

export const SAMPLE_ISSUE = {
  summary: 'Halden Bank vendor security assessment (due 15 Jan)',
  filename: 'Halden-Bank-Vendor-Security-Assessment-2026.xlsx',
  description: 'Halden Bank sent their annual third-party security assessment for Brightlake. 40 questions; answers are due by 15 January. Attached as received.',
};

/** The sample questionnaire as rows for buildXlsx (title rows, a blank row, headers on row 4). */
export function sampleRows() {
  return [
    ['Halden Bank: Third-Party Security Assessment'],
    ['Vendor: Brightlake Ltd   ·   Cycle: 2026   ·   Return by: 15 January 2027'],
    [''],
    ['Ref', 'Domain', 'Question', 'Response (Yes / No / N/A)', 'Comments / Evidence'],
    ...SAMPLE_QUESTIONS.map(([ref, domain, q]) => [ref, domain, q, '', '']),
  ];
}
export const SAMPLE_XLSX_OPTS = { sheetName: 'Assessment', widths: [10, 20, 70, 16, 70], headerRow: 4, titleRows: [1] };

// Answer key for the benchmark: the policy page a correct answer cites ('library' for an approved answer, null for
// a question with no policy). Arrays list acceptable alternatives.
export const SAMPLE_KEY = {
  'GOV-01': 'library', 'GOV-02': 'library',
  'ENC-01': 'Encryption Standard', 'ENC-02': 'Encryption Standard', 'ENC-03': 'Encryption Standard', 'ENC-04': 'Encryption Standard',
  'IAM-01': 'Access Control and SSO Policy', 'IAM-02': 'Access Control and SSO Policy', 'IAM-03': 'Access Control and SSO Policy',
  'IAM-04': 'Access Control and SSO Policy', 'IAM-05': 'Access Control and SSO Policy',
  'RET-01': 'Data Retention and Deletion Policy', 'RET-02': 'Data Retention and Deletion Policy', 'RET-03': 'Data Retention and Deletion Policy',
  'INC-01': 'Incident Response Plan', 'INC-02': 'Incident Response Plan', 'INC-03': 'Incident Response Plan', 'INC-04': 'Incident Response Plan',
  'BCP-01': 'Business Continuity and Disaster Recovery Plan', 'BCP-02': 'Business Continuity and Disaster Recovery Plan', 'BCP-03': 'Business Continuity and Disaster Recovery Plan',
  'SUB-01': 'Subprocessor Management', 'SUB-02': 'Subprocessor Management',
  'SDL-01': 'Secure Development Lifecycle', 'SDL-02': 'Secure Development Lifecycle', 'SDL-03': 'Secure Development Lifecycle',
  'VUL-01': 'Vulnerability Management Policy', 'VUL-02': 'Vulnerability Management Policy', 'VUL-03': 'Vulnerability Management Policy', 'VUL-04': ['Vulnerability Management Policy', 'library'],
  'HRS-01': 'HR Security Policy', 'HRS-02': 'HR Security Policy',
  'PHY-01': 'Physical Security Policy', 'PHY-02': 'Physical Security Policy',
  'RES-01': 'Subprocessor Management',
  'GAP-01': null, 'GAP-02': null, 'GAP-03': null, 'GAP-04': null, 'GAP-05': null,
};

// The same ground in customer wording (paraphrased, no shared phrasing with the policies), with its answer key.
// Used by the benchmark to check that answers survive paraphrase and that gaps stay gaps.
const E = 'Encryption Standard', A = 'Access Control and SSO Policy', R = 'Data Retention and Deletion Policy', I = 'Incident Response Plan';
const B = 'Business Continuity and Disaster Recovery Plan', S = 'Subprocessor Management', D = 'Secure Development Lifecycle', V = 'Vulnerability Management Policy';
export const PARAPHRASED = [
  ['P01', 'Is there a dedicated team accountable for information security?', 'library'],
  ['P02', 'How often does leadership sign off on your security policies?', 'library'],
  ['P03', 'What cipher protects our data while it is stored on your servers?', E],
  ['P04', 'Which protocol versions secure the connection between our users and your service?', E],
  ['P05', 'Who holds the cryptographic keys, and how often are they replaced?', E],
  ['P06', 'Can we supply and revoke our own key material?', E],
  ['P07', 'Is our data logically segregated from other customers in a multi-tenant environment?', A],
  ['P08', 'Do your staff log in to internal tools through a central identity provider?', A],
  ['P09', 'Is a second factor enforced for privileged accounts?', A],
  ['P10', 'How often are user entitlements recertified?', A],
  ['P11', 'When an employee departs, how fast are their accounts disabled?', A],
  ['P12', 'Can our users sign in with our Okta or Azure AD tenant?', A],
  ['P13', 'Do engineers have standing access to production?', A],
  ['P14', 'What happens to our records once our subscription ends, and when are they purged?', R],
  ['P15', 'Are backups of our data destroyed after we leave, and on what schedule?', R],
  ['P16', 'Can we download a full copy of everything we stored with you?', R],
  ['P17', 'Do you keep security audit trails, and for how long?', R],
  ['P18', 'If our data is compromised, how soon will you tell us?', I],
  ['P19', 'Is there a formal process for handling security events?', I],
  ['P20', 'Do you rehearse your incident handling, for example with tabletop exercises?', I],
  ['P21', 'Is someone watching security alerts outside business hours?', I],
  ['P22', 'What is your maximum tolerable data loss and downtime in a disaster?', B],
  ['P23', 'Can the platform survive the loss of a single data centre?', B],
  ['P24', 'How frequently do you prove that backups can actually be restored?', B],
  ['P25', 'Where can we see which other companies handle our data on your behalf?', S],
  ['P26', 'Will you warn us before bringing in a new vendor that processes our data?', S],
  ['P27', 'Do the vendors that process our data sign data protection terms?', S],
  ['P28', 'Is every change to source code checked by a second developer before release?', D],
  ['P29', 'Do you scan code for security flaws and vulnerable libraries during CI?', D],
  ['P30', 'Is live customer data ever copied into test systems?', D],
  ['P31', 'How quickly do you fix critical security weaknesses once found?', V],
  ['P32', 'Do you hire an outside firm to try to break into your platform?', V],
  ['P33', 'How can a researcher report a security bug to you?', V],
  ['P34', 'Are new hires screened before they start?', 'HR Security Policy'],
  ['P35', 'Do employees get phishing training?', 'HR Security Policy'],
  ['P36', 'Who can physically enter the buildings where our data is hosted?', 'Physical Security Policy'],
  ['P37', 'Do you hold an insurance policy that covers cyber incidents?', null],
  ['P38', 'Do staff need a VPN to reach internal systems from home?', null],
  ['P39', 'Can you send us your latest external audit or compliance report?', null],
  ['P40', 'Are DMARC and DKIM configured for your mail domains?', null],
];
