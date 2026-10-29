// L&D induction step C1 — "Maxvolt Induction Course": the whole of the "Final Induction Deck" (25 slides, 13 topics) taught as
// interactive lessons inside Maxvolt One instead of a PDF. Study time is tracked, then a quiz made from the lessons.
// Source: D:\HR Structure\Final Induction Deck.pdf (HR). Photos cropped from the deck (leadership portraits, plant and event photos)
// live in backend/assets/ld-course — NOT in the public web folder: they are inlined into the signed-in API response only.
// HR / L&D: this is the single place to edit the lesson text and the question bank. Where the deck and the live app disagree
// (leave quotas, the account-creation steps) the lesson says what the deck says and the question bank stays away from it.
// Pure data + logic (no database), unit-tested in backend/tests/ldCourse.test.mjs.
import fs from 'node:fs';
import { seededRng, COURSE_STUDY_SECONDS, COURSE_QUIZ_QUESTIONS } from './ldOpening.js';

export { COURSE_STUDY_SECONDS, COURSE_QUIZ_QUESTIONS };   // 900 s of visible study time, then a 15-question quiz
export const COURSE_CONTENT_UPDATED = '2026-10';

const C = '/ld-course/';
const P = '/ld-products/';
const img = (dir, file, caption) => ({ src: `${dir}${file}.webp`, caption });
// block helpers — the page renders each of these
const p = (text) => ({ t: 'p', text });
const list = (items) => ({ t: 'list', items });
const stats = (items) => ({ t: 'stats', items });                 // [[label, value], …]
const cards = (items, cols = 2) => ({ t: 'cards', items, cols });  // [{ title, text, tag? }, …]
const table = (head, rows) => ({ t: 'table', head, rows });
const timeline = (items) => ({ t: 'timeline', items });            // [{ label, text }, …]
const steps = (items) => ({ t: 'steps', items });                  // [{ title, text }, …]
const people = (items) => ({ t: 'people', items });                // [{ name, role, focus, photo }, …]
const callout = (title, text, tone = 'yellow') => ({ t: 'callout', title, text, tone });
const images = (items) => ({ t: 'images', items });
const chips = (items) => ({ t: 'chips', items });

export const COURSE_MODULES = [
  { id: 'who', no: 1, title: 'Who we are', subtitle: 'Company overview, mission and vision', blocks: [
    p('Maxvolt Energy Industries Limited is an Indian manufacturer of lithium-ion battery solutions, established in 2019 and headquartered in Ghaziabad, Uttar Pradesh.'),
    images([img(C, 'plant-aerial', 'Maxvolt Energy Industries Limited, Ghaziabad')]),
    stats([['Established', '2019'], ['Headquarters', 'Ghaziabad, Uttar Pradesh'], ['Tagline', 'Energizing Future']]),
    cards([
      { title: 'Humble beginnings', text: 'Started with an initial production capacity of around 15 batteries per day.' },
      { title: 'Expanded horizons', text: 'Expanded into a broader energy-storage and electric-mobility solutions company.' },
      { title: 'Core business', text: 'Operates in the electric battery and related components segment.' },
      { title: 'Wide applications', text: 'Solutions serve electric mobility, energy storage, inverter applications and customised battery requirements.' },
    ]),
    callout('The journey in one line', 'From an initial production setup to a growing energy-solutions organisation, Maxvolt\'s journey is defined by product development, manufacturing scale, customer relationships and continuous expansion.'),
    p('Our anchors: Safety · Quality · Innovation · Sustainability. Our themes: People · Technology · Sustainability · Growth.'),
    cards([
      { title: 'Our mission', tag: 'Why we exist', text: 'At Maxvolt Energy, our mission goes beyond batteries. We are committed to delivering safe, reliable and sustainable energy solutions that power a better future. By understanding the needs of our customers and communities, we strive to create lasting value and make a meaningful impact on every life we touch.' },
      { title: 'Our vision', tag: 'Where we are heading', text: 'We believe in a world where energy brings hope, opportunity and light to everyone. Our vision is to reduce carbon footprints, empower clean urban transportation and integrate renewable energy — all while nurturing the planet for future generations.' },
    ], 1),
    callout('What this means for you', 'Your role may not directly involve battery engineering or manufacturing, but your work still contributes to the quality, speed, reliability and sustainability of Maxvolt\'s overall operation.'),
    stats([['Quality', 'Better products and services'], ['Speed', 'Faster delivery and execution'], ['Reliability', 'Consistent performance'], ['Sustainability', 'A cleaner, greener future']]),
  ] },

  { id: 'values', no: 2, title: 'What we stand for', subtitle: 'Our six core values', blocks: [
    p('Our values power progress. Each one describes how we are expected to behave at Maxvolt every day.'),
    table(['Value', 'What it means at Maxvolt'], [
      ['Innovation', 'Constantly improving our products, processes and technology.'],
      ['Integrity', 'Acting honestly and transparently in everything we do.'],
      ['Customer Commitment', 'Understanding and delivering on what our customers need.'],
      ['Safety First', 'Protecting our people above all else, on the floor and off it.'],
      ['Teamwork, Ownership & Accountability', 'Working together and owning our outcomes.'],
      ['Sustainability', 'Building energy solutions that respect the planet.'],
    ]),
    images([img(P, 'pack-escooter', 'A Maxvolt smart lithium-ion pack')]),
    chips(['Innovation today', 'Stronger people', 'Greener tomorrow']),
  ] },

  { id: 'business', no: 3, title: 'Our business', subtitle: 'Scale, products and customers', blocks: [
    p('Business at a glance — our scale today:'),
    stats([['Units per month', '25,000+'], ['Retail dealers', '950+'], ['OEM partners', '107+'], ['States covered', '22+'], ['Team members', '350+'], ['Year founded', '2019']]),
    callout('A stronger, cleaner tomorrow', 'Growing scale. Greater impact. As we expand, we power more people, more possibilities and a cleaner, brighter future.'),
    p('What we make — four product families:'),
    cards([
      { tag: 'EV', title: 'Electric Mobility Batteries', text: 'Lithium-ion battery packs powering two- and three-wheeler electric vehicles across the dealer and OEM network.' },
      { tag: 'ESS', title: 'Energy Storage Systems', text: 'Storage solutions supporting renewable integration and backup power for homes and businesses.' },
      { tag: 'INV', title: 'Inverter Batteries', text: 'Reliable battery solutions built for inverter applications.' },
      { tag: 'OEM', title: 'Custom Battery Solutions', text: 'Bespoke packs designed and certified to OEM partner specifications.' },
    ]),
    images([img(P, 'hero-escooter', 'EV'), img(P, 'rack-cabinet-site', 'ESS'), img(P, 'home-inverter-battery', 'INV'), img(P, 'custom-packs', 'OEM')]),
    callout('Remember', 'Different applications can have different technical, performance, delivery and service requirements. Customer understanding therefore matters across departments.'),
    p('Want the detail on every product? The next step in your induction, "Know our products, services and segments", goes through the full range.'),
  ] },

  { id: 'journey', no: 4, title: 'Our journey', subtitle: 'Growth 2019–2026, recent expansion and the next chapter', blocks: [
    p('How far we\'ve come — the growth journey from 2019 to 2026:'),
    timeline([
      { label: '2019', text: 'First prototype developed; unit setup; production trial.' },
      { label: '2020', text: 'First OEM supply; retail dealer network launched; Bengaluru service centre opened.' },
      { label: '2022', text: 'R&D centre established; safety-compliant battery development; channel growth.' },
      { label: '2024', text: 'Crossed ₹100 Cr+ revenue; 12,500+ packs per month.' },
      { label: '2025', text: 'NSE SME listing under MAXVOLT; Eco-Series launch; AIS 156 certification; Duhai facility expanded to about 55,000 sq. ft.' },
      { label: '2026', text: 'Maxvolt ReEarth incorporated; Aligarh 10 GWh expansion underway; target ₹600 Cr annual turnover.' },
    ]),
    callout('', '"From possibilities to progress — and a cleaner, brighter tomorrow."'),
    p('Building at speed — recent expansion and achievements:'),
    cards([
      { title: 'NSE SME listing — a new milestone', text: 'Maxvolt was listed on the NSE SME platform under the symbol MAXVOLT in February 2025. The IPO raised ₹54 Cr gross, with roughly ₹39 Cr net proceeds directed toward manufacturing capex, working capital, partial debt repayment and ReEarth development.' },
      { title: 'Duhai facility expansion — scaling manufacturing', text: 'The Duhai manufacturing facility was expanded to approximately 55,000 sq. ft. in December 2025, alongside a 23,000 sq. ft. corporate office and Centre of Excellence / NPD site. The induction material states an installed annual capacity of roughly 2.3 GWh and monthly output of around 40,000 battery packs.' },
      { title: 'Aligarh 10 GWh expansion — powering the next phase', text: 'Maxvolt received a land allotment from the Uttar Pradesh Government (announced by the Hon\'ble Chief Minister at the "Uttar Pradesh – Udhyam Pradesh" event on International MSME Day, July 2025) for a new lithium-ion battery manufacturing campus at Aligarh, Uttar Pradesh. Phase 1 targets 5 GWh, split between Battery Energy Storage Systems and Electric Mobility capacity. Phase 2 adds a further 5 GWh for broader market and export demand.' },
    ], 1),
    images([img(C, 'nse-listing', 'NSE listing ceremony, February 2025'), img(C, 'duhai-floor', 'Duhai manufacturing floor'), img(C, 'aligarh-handover', 'Aligarh land allotment')]),
    stats([['Manufacturing facility', '55,000 sq. ft.'], ['Corporate office & CoE / NPD', '23,000 sq. ft.'], ['Installed annual capacity', '2.3 GWh'], ['Packs per month', '40,000'], ['Aligarh', '10 GWh in phases'], ['Phase 1 / Phase 2', '5 GWh + 5 GWh']]),
    p('The next chapter — expanding capacity, intelligence and recovery:'),
    cards([
      { tag: 'Expand', title: 'Bigger today, brighter tomorrow', text: 'Aligarh Phase 2 and continued automation and capacity investment to meet demand.' },
      { tag: 'Recover', title: 'Closing the loop, creating value', text: 'Scale Maxvolt ReEarth toward its 15,000 MT and 8,500 MT p.a. processing milestones.' },
      { tag: 'Intelligence', title: 'Smarter batteries, a connected future', text: 'AI-enabled BMS, traceability and digital battery passport initiatives.' },
      { tag: 'Innovate', title: 'Ideas today, impact tomorrow', text: 'R&D collaborations, including with IIT Delhi and IIT Roorkee, and proprietary process development.' },
    ]),
    callout('What this means for employees', 'Growth creates new opportunities, but it also increases the need for learning, process discipline, collaboration, technology adoption and ownership.'),
  ] },

  { id: 'rearth', no: 5, title: 'Maxvolt ReEarth', subtitle: 'The circular battery lifecycle', blocks: [
    p('Maxvolt ReEarth — extending battery value beyond its first life. It is a dedicated subsidiary building an integrated ecosystem for battery reuse, recycling and critical-material recovery.'),
    callout('A cleaner tomorrow is a stronger tomorrow', 'Giving batteries a second life and materials a brighter future.', 'green'),
    p('The circular battery lifecycle — from end-of-life to a brighter tomorrow:'),
    steps([
      { title: 'Collect', text: 'End-of-life batteries are gathered through Maxvolt\'s collection network.' },
      { title: 'Assess', text: 'Health grading determines second-life suitability.' },
      { title: 'Recover', text: 'Black mass and other reusable materials are extracted.' },
      { title: 'Refine', text: 'Materials are processed into battery-grade critical minerals.' },
      { title: 'Reintegrate', text: 'Recovered materials are returned to the battery value chain.' },
    ]),
    p('Phased roadmap — building capacity for a circular future:'),
    table(['Phase', 'Target'], [
      ['Phase 1', 'Technology validation; laboratory development and pilot testing.'],
      ['Phase 2', '15,000 MT p.a. planned commercial battery-processing capacity.'],
      ['Phase 3', '8,500 MT p.a. planned critical-mineral refining capacity.'],
    ]),
    callout('Target outcome', '99%+ target battery-grade material purity across Lithium, Nickel, Cobalt, Manganese and Graphite.', 'green'),
    chips(['Cleaner communities', 'Circular economy', 'Resource security', 'Healthier planet']),
  ] },

  { id: 'research', no: 6, title: 'Research & Publications', subtitle: 'Five research papers achieved in 2026', blocks: [
    p('Maxvolt\'s research initiatives show a growing focus on innovation, sustainability, digitalisation and advanced battery technologies. During 2026, the organisation and its research team achieved five documented research-paper milestones across battery recycling, manufacturing, digital traceability, circular supply chains and net-zero energy systems.'),
    cards([
      { tag: '1 · Published', title: 'A Comparative Evaluation of Lithium-Ion Battery Recycling Technologies: Pyrometallurgical, Hydrometallurgical, and Direct Recycling Approaches', text: 'Maxvolt ReEarth · International Journal of Novel Research and Development · DOI 10.56975/ijnrd.v11i5.324740' },
      { tag: '2 · Published', title: 'Advanced Manufacturing Processes and Digital System Integration for High-Performance Lithium-Ion Battery Pack Production: A Case Study of Maxvolt Industries in 2W and 3W Electric Mobility Applications', text: 'Maxvolt Energy · International Journal of Battery Technology · DOI 10.34218/IJBTT_07_02_001' },
      { tag: '3 · In press', title: 'Design and Implementation of a Digital Traceability System for Lithium-Ion Battery Assembly and Dispatch Management', text: 'Maxvolt Energy · International Journal of Artificial Intelligence and Machine Learning · DOI awaited' },
      { tag: '4 · Published', title: 'A 6R-Based Circular EV Battery Supply Chain in India: Technology Roadmap and Insights from Maxvolt ReEarth', text: 'Maxvolt ReEarth · International Journal of Environmental Sciences · Scopus-indexed, Q3 · DOI 10.64252/zvndrn48' },
      { tag: '5 · Presented', title: 'A Recycling-Integrated Circular Energy System for Net-Zero Transition: The Maxvolt ReEarth Framework for Sustainable EV Battery Management', text: 'Maxvolt ReEarth · National Conference on Net Zero Energy Systems 2026, National Institute of Technology, Jalandhar · Paper ID 46' },
    ], 1),
    callout('Research excellence as an achievement', 'Our research translates real operational challenges into practical solutions — strengthening our products, enabling a circular economy and contributing to a cleaner, more sustainable future. "Research turns today\'s challenges into tomorrow\'s opportunities."'),
  ] },

  { id: 'operate', no: 7, title: 'How we operate', subtitle: 'Business model, production and quality', blocks: [
    p('Maxvolt\'s manufacturing, customisation, distribution, service and lifecycle capabilities work as one connected system — the end-to-end business model:'),
    steps([
      { title: 'Source', text: 'Strategic components and materials — quality materials for a reliable future.' },
      { title: 'Design', text: 'Custom pack and product development — innovation for real-world solutions.' },
      { title: 'Make', text: 'Testing, validation and certified production — built with precision, certified for performance.' },
      { title: 'Distribute', text: 'OEM, dealer and distributor channels — powering customers across the nation.' },
      { title: 'Service', text: 'Diagnostics, claims and replacement support — support for a longer, stronger journey.' },
      { title: 'Return', text: 'Reverse logistics, repurposing and recycling — closing the loop with ReEarth.' },
    ]),
    callout('The employee connection', 'Every function contributes to product performance, customer confidence and responsible end-of-life handling.'),
    p('Production and quality — built to certified standards. From quality components to reliable energy solutions: engineered, tested and trusted.'),
    images([img(C, 'production-worker', 'On the production floor'), img(C, 'battery-assembly', 'Battery pack assembly')]),
    p('Production flow — from components to a cleaner tomorrow:'),
    steps([
      { title: 'Material & component sourcing', text: '' }, { title: 'Custom battery design', text: '' }, { title: 'Assembly & BMS integration', text: '' },
      { title: 'Testing / validation', text: '' }, { title: 'Certification support', text: '' }, { title: 'Dispatch & service', text: '' },
    ]),
    p('Quality anchors — trusted, tested, certified:'),
    cards([
      { tag: 'ISO 9001:2015', title: 'Certified manufacturing facility', text: 'Our quality management system.' },
      { tag: 'AIS 156', title: 'Product safety compliance', text: 'Certification for product safety compliance.' },
      { tag: 'Safety first', title: 'Protocols and PPE', text: 'Safety protocols and PPE are mandatory for every employee on the floor.' },
    ], 3),
    callout('Quality is everyone\'s responsibility', 'Quality is not created only at final inspection. The work performed by Purchase, Stores, Production, Testing, Quality, Logistics, Service and support functions can all affect the final customer outcome.', 'green'),
  ] },

  { id: 'fit', no: 8, title: 'Where you fit in', subtitle: 'Leadership and departments', blocks: [
    p('Who leads us — the leadership team. "Guiding today. Powering a brighter tomorrow."'),
    people([
      { name: 'Bhuvneshwar Pal Singh', role: 'Co-Founder, MD & CFO', focus: 'Finance, accounts and operations.', photo: 'leader-bhuvneshwar' },
      { name: 'Vishal Gupta', role: 'Co-Founder, Chairman & Whole-Time Director', focus: 'Operations and R&D.', photo: 'leader-vishal' },
      { name: 'Satendra Shukla', role: 'Co-Founder & CEO', focus: 'Finance, analytics and business development.', photo: 'leader-satendra' },
      { name: 'Sachin Gupta', role: 'Chief Operating Officer', focus: 'Business growth, strategy, finance and risk.', photo: 'leader-sachin' },
      { name: 'Mukesh Gupta', role: 'CMO & CHRO', focus: 'Marketing and HR management.', photo: 'leader-mukesh' },
      { name: 'Payal Jain', role: 'Lead Research Engineer', focus: 'Next-generation energy storage R&D.', photo: 'leader-payal' },
      { name: 'Narendra Shukla', role: 'Business Development Head', focus: 'Strategic partnerships and market expansion.', photo: 'leader-narendra' },
      { name: 'Pawan Jha', role: 'National Sales Head', focus: 'Sales network and revenue growth.', photo: 'leader-pawan' },
    ]),
    p('Maxvolt\'s organisation chart identifies multiple functions working together to deliver products, services and business outcomes. The departments:'),
    chips(['Production', 'Sales', 'Service', 'New Product Development (NPD)', 'Logistics', 'Finance & Accounts', 'Admin / Store / Testing', 'Quality', 'HR', 'Purchase', 'Marketing', 'Business Projects & Planning', 'Management', 'Information Technology', 'Legal & Compliance', 'MIS', 'PPC', 'R&D']),
    callout('Your place in the organisation', 'You are joining one department, but you are joining one company. The quality of your output can affect people and processes outside your immediate team. One team · Shared goals · Greater impact.'),
  ] },

  { id: 'work', no: 9, title: 'How we work', subtitle: 'Culture and the Code of Conduct', blocks: [
    p('Our culture is built on safety, respect, integrity and responsibility. These values guide how we work, with each other, with our partners and in our communities. "Do the right thing. Every day."'),
    cards([
      { title: 'Safety', text: 'Follow safety protocols and procedures; use PPE correctly, always.' },
      { title: 'Respect', text: 'No discrimination, harassment, bullying or inappropriate conduct.' },
      { title: 'Integrity', text: 'Act honestly and protect confidential information and company assets.' },
      { title: 'Responsibility', text: 'Respect environmental requirements, reduce waste and support responsible disposal.' },
    ], 4),
    callout('Zero tolerance', 'Harassment · Inappropriate language or actions · Theft or fraud · Misuse of company property, data or resources.', 'red'),
    callout('Speak up', 'Report incidents or concerns immediately to HR or your supervisor. Concerns are investigated, and the Code prohibits retaliation for good-faith reporting.', 'green'),
    chips(['Work safe', 'Work together', 'Build better', 'Go further']),
    p('A safe, respectful and responsible workplace for everyone.'),
  ] },

  { id: 'hr', no: 10, title: 'Working at Maxvolt', subtitle: 'Working hours, attendance, leave and benefits', blocks: [
    p('Working hours, attendance and leave — clear policies, a more productive you. Here\'s what you need to know:'),
    table(['Topic', 'What to know'], [
      ['Shift timings', '9:00 AM – 6:00 PM or 10:00 AM – 7:00 PM. 6-day working week.'],
      ['Attendance', 'Marked via Maxvolt One; selfie + GPS where biometric is unavailable.'],
      ['Missed punch', 'Manager approval within 12 working hours, or marked absent.'],
      ['Grace period', '15 min for the morning shift; up to 3 late arrivals a month; the 4th onward = half-day deduction.'],
      ['Overtime', 'Applicable to Production, Service, Logistics, Store and Admin.'],
      ['Flexi hours', '±30 min for eligible departments/levels, fully compensated the same day.'],
      ['Casual Leave', '7 days a year; maximum 3 days at a stretch; cannot be carried forward.'],
      ['Earned Leave', '15 days a year; usable after probation confirmation; carries forward.'],
      ['Sick Leave', '7 days a year — Manager and above; medical proof beyond 2 days.'],
      ['Paid holidays', '10 days a year; published at the start of the year.'],
    ]),
    callout('Important', 'Employees should follow the current approved policy where a policy is updated or more detailed conditions apply. Your Leave page in Maxvolt One always shows your actual balances.'),
    p('Mark your attendance on Maxvolt One — easy, secure, anywhere: selfie + GPS (where biometric is unavailable).'),
    p('Benefits that support you — we care for our people. Our benefits are designed to support you and your family at every stage of life. People first: your well-being helps us build a stronger tomorrow.'),
    cards([
      { title: 'Maternity leave', text: '26 weeks fully paid (8 weeks pre-delivery + 18 weeks post-delivery), with extra provisions for miscarriage, adoption and pregnancy-related illness. Work-from-home may be requested post-leave.' },
      { title: 'Paternity leave', text: '15 calendar days paid for confirmed male employees with 6+ months\' service, to be availed within 3 months of childbirth.' },
      { title: 'Gratuity', text: 'Payable after 5 years of continuous service, subject to the stated conditions and applicable policy.' },
      { title: 'Travel & reimbursement', text: 'Six designation-based travel categories with defined lodging, daily allowance and conveyance entitlements; claims are submitted via Maxvolt One within 30 days.' },
    ]),
  ] },

  { id: 'one', no: 11, title: 'Maxvolt One', subtitle: 'Your HRMS, all in one place', blocks: [
    p('Maxvolt One is the in-house digital platform developed for Maxvolt. It brings together Human Resources, Payroll, Compliance, Recruitment, Training and Operations under one roof, with role-based access. Platform access and features are role-based; employees see the functions relevant to their assigned access.'),
    cards([
      { title: 'Dashboard', text: 'Attendance status, approvals, leave balance, holidays and announcements.' },
      { title: 'Mark Attendance', text: 'Selfie + GPS check-in / check-out.' },
      { title: 'Leave', text: 'Apply, track and view balance / history.' },
      { title: 'My Payslips', text: 'View and download with full breakup.' },
      { title: 'My Documents', text: 'Access onboarding and HR-shared documents.' },
      { title: 'Expenses & Reimbursements', text: 'Submit and track claims.' },
      { title: 'My Performance', text: 'Goals, progress and review history.' },
      { title: 'Helpdesk', text: 'HR / Finance / IT / Admin tickets.' },
      { title: 'My Training', text: 'Assigned sessions, calendar and history.' },
      { title: 'Gate Pass', text: 'Request and track premises exit / return.' },
      { title: 'My Insurance', text: 'Coverage, nominee and claims.' },
      { title: 'AskMax', text: 'AI-powered policy assistance.' },
      { title: 'Company Policies', text: 'Centralised policy repository.' },
    ], 3),
    p('Your first login — the steps in the deck:'),
    steps([
      { title: 'Receive your registration link', text: 'HR sends it to you by email.' },
      { title: 'Open Maxvolt One', text: 'Go to maxone.maxvoltenergy.com and use the registration link HR sent you.' },
      { title: 'Create your account', text: 'Use your official email address.' },
      { title: 'Complete the Onboarding Form', text: 'Fill all sections and upload the required documents.' },
      { title: 'Wait for HR', text: 'HR reviews and approves your submission.' },
      { title: 'Open your Employee Dashboard', text: 'Once approved, access your full Employee Dashboard.' },
      { title: 'Mark your attendance', text: 'On your first working day.' },
      { title: 'Explore AskMax', text: 'For instant answers to policy questions.' },
    ]),
    callout('', 'One platform. Many possibilities. A better you.'),
  ] },

  { id: 'growth', no: 12, title: 'Your journey', subtitle: 'Growth path, first 30/60/90 days and first-week checklist', blocks: [
    p('Your growth path at Maxvolt — a clear journey, real opportunities, a brighter future, together.'),
    steps([
      { title: 'Joining & onboarding', text: 'Complete documentation, understand the organisation and settle into the workplace.' },
      { title: 'Probation', text: 'Build role capability, discipline, process understanding and dependable performance.' },
      { title: 'Training & development', text: 'Complete assigned learning and develop functional capability.' },
      { title: 'Performance reviews', text: 'Understand goals, progress and feedback.' },
      { title: 'Career growth', text: 'Build capability and take on increasing responsibility.' },
      { title: 'Internal opportunities', text: 'Explore appropriate opportunities as capability and business needs develop.' },
    ]),
    callout('Remember', 'Goals are set with your Reporting Manager and tracked through Maxvolt One\'s Performance module. Review cycles support growth conversations and internal mobility.'),
    p('Your first 30 / 60 / 90 days — settling in, step by step:'),
    cards([
      { tag: 'Days 1–30', title: 'Learn & Adapt', text: 'Get to know. Get comfortable. Get started.' },
      { tag: 'Days 31–60', title: 'Perform & Improve', text: 'Take ownership. Build momentum.' },
      { tag: 'Days 61–90', title: 'Own & Contribute', text: 'Deliver impact. Grow with Maxvolt.' },
    ], 3),
    list([
      'Days 1–30: Understand Maxvolt and your department. Complete mandatory induction and role training. Understand your SOPs and systems. Build relationships with your team and key SPOCs. Begin performing assigned tasks with guidance. Understand your initial KPIs and expectations.',
      'Days 31–60: Perform routine responsibilities with greater independence. Meet agreed timelines and quality expectations. Coordinate directly with relevant departments. Identify recurring problems or process gaps. Seek feedback and improve execution.',
      'Days 61–90: Handle assigned responsibilities independently. Demonstrate ownership and accountability. Consistently meet role expectations. Contribute process-improvement ideas where appropriate. Demonstrate effective cross-functional working. Discuss development needs and next-stage responsibilities with your Reporting Manager.',
    ]),
    p('Your first-week checklist — start strong. Get oriented, build connections, set yourself up for success:'),
    list([
      'Read, understand and sign the Code of Conduct.',
      'Learn your role\'s process and how it connects with other departments.',
      'Understand the customer promise: quality, responsive service and lifecycle responsibility.',
      'Know how your work connects to EV, ESS, OEM or service outcomes.',
      'Ask your team for its operating rhythm, targets and cross-functional interfaces.',
      'Connect with each department\'s SPOC as per your week\'s induction plan.',
    ]),
    callout('By the end of Week 1', 'You should know what Maxvolt does, what your department does, what your role owns, which systems you use, who supports you and what you are expected to learn next.'),
  ] },

  { id: 'support', no: 13, title: 'Your support network', subtitle: 'Buddy, key contacts and Helpdesk', blocks: [
    p('The right support helps you settle in, stay productive and grow at Maxvolt.'),
    callout('Buddy programme', 'Every new joiner is paired with a buddy — a peer, not your manager — who helps you settle in, answers day-to-day questions and acts as a friendly first point of contact through the first few weeks.'),
    p('Helpdesk categories — where to go for what:'),
    table(['Need', 'Where to go'], [
      ['HR', 'Leave, salary and documentation queries.'],
      ['Finance', 'Reimbursements, tax and payroll.'],
      ['IT', 'Hardware, software access and network.'],
      ['Admin', 'Facility, travel and stationery.'],
      ['AskMax', 'Instant, 24/7 policy answers — no ticket needed.'],
    ]),
    callout('Know the difference', 'Your Buddy helps with day-to-day settling in. Your Reporting Manager handles work and performance. HR handles employee matters. Helpdesk routes formal support requests. AskMax provides policy information.'),
    callout('Before we close', 'Ask any question you have about Maxvolt, your workplace, the employee systems, the induction process or your first few weeks. Next step: department and role-specific onboarding with your Reporting Manager / Department Trainer.', 'green'),
    p('Welcome to the team — let\'s energize the future together. Same people. A brighter tomorrow.'),
  ] },
];

// ── question bank ────────────────────────────────────────────────────────
// q(module, question, right answer, three wrong answers)
const q = (module, text, right, wrong) => ({ module, text, right, wrong });
export const COURSE_QUESTION_BANK = [
  q('who', 'In which year was Maxvolt Energy Industries Limited established?', '2019', ['2010', '2015', '2022']),
  q('who', 'Where is Maxvolt headquartered?', 'Ghaziabad, Uttar Pradesh', ['Noida, Uttar Pradesh', 'Pune, Maharashtra', 'Bengaluru, Karnataka']),
  q('who', 'What is Maxvolt\'s tagline?', 'Energizing Future', ['Power for All', 'Think Green', 'Charge Ahead']),
  q('who', 'About how many batteries per day was the initial production capacity?', 'Around 15', ['Around 150', 'Around 1,500', 'Around 15,000']),
  q('who', 'According to our mission, Maxvolt\'s mission…', 'goes beyond batteries', ['is only to sell batteries', 'is limited to exports', 'is only about profit']),
  q('who', 'Which of these is part of Maxvolt\'s vision?', 'Reduce carbon footprints and empower clean urban transportation', ['Open retail shops in every city', 'Make only consumer electronics', 'Stop manufacturing']),
  q('values', 'Which core value is described as "Protecting our people above all else, on the floor and off it"?', 'Safety First', ['Integrity', 'Innovation', 'Customer Commitment']),
  q('values', 'Which core value means "Acting honestly and transparently in everything we do"?', 'Integrity', ['Sustainability', 'Teamwork', 'Innovation']),
  q('values', 'Which core value means "Constantly improving our products, processes and technology"?', 'Innovation', ['Integrity', 'Safety First', 'Sustainability']),
  q('values', 'How many core values does Maxvolt have?', 'Six', ['Three', 'Four', 'Ten']),
  q('business', 'Which product family is called "INV"?', 'Inverter batteries', ['Investor relations', 'Industrial vehicles', 'Indoor ventilation']),
  q('business', 'What does "OEM" custom battery solutions mean at Maxvolt?', 'Bespoke packs designed and certified to OEM partner specifications', ['Standard packs sold only in shops', 'Packs for toys only', 'Used batteries']),
  q('business', 'Which two kinds of electric vehicles do our EV batteries mainly power?', 'Two- and three-wheelers', ['Trains and ships', 'Aircraft', 'Only four-wheelers']),
  q('business', 'Roughly how many retail dealers does Maxvolt have?', '950+', ['95', '250', '5,000']),
  q('business', 'In how many states does Maxvolt operate (as per the deck)?', '22+', ['5', '10', '36']),
  q('journey', 'Under which NSE symbol is Maxvolt listed?', 'MAXVOLT', ['MVEL', 'VOLTX', 'BATT']),
  q('journey', 'What did the 2022 milestone in our growth journey establish?', 'An R&D centre', ['The first OEM supply', 'ReEarth', 'The NSE listing']),
  q('journey', 'Where is Maxvolt developing its 10 GWh expansion?', 'Aligarh, Uttar Pradesh', ['Pune', 'Chennai', 'Jaipur']),
  q('journey', 'How is the Aligarh expansion planned?', 'In two phases of 5 GWh each', ['In one 10 GWh phase', 'In ten phases of 1 GWh', 'In three phases of 4 GWh']),
  q('journey', 'Which kind of capacity does Aligarh Phase 1 target?', 'Battery Energy Storage Systems and Electric Mobility', ['Only exports', 'Only solar panels', 'Only recycling']),
  q('journey', 'With which institutes does Maxvolt have R&D collaborations?', 'IIT Delhi and IIT Roorkee', ['IIM Ahmedabad and IIT Madras', 'IISc and ISRO', 'None']),
  q('rearth', 'What is Maxvolt ReEarth?', 'A subsidiary for battery reuse, recycling and critical-material recovery', ['A dealer network', 'A new vehicle brand', 'An HR programme']),
  q('rearth', 'Which is the correct order of the ReEarth lifecycle?', 'Collect, Assess, Recover, Refine, Reintegrate', ['Recover, Collect, Refine, Assess, Reintegrate', 'Assess, Collect, Reintegrate, Recover, Refine', 'Refine, Recover, Collect, Assess, Reintegrate']),
  q('rearth', 'What does the "Assess" step of the ReEarth lifecycle decide?', 'Second-life suitability through health grading', ['The dealer margin', 'The shipping route', 'The warranty price']),
  q('rearth', 'What purity is the ReEarth target outcome for battery-grade materials?', '99%+', ['50%', '75%', '90% only']),
  q('research', 'How many research-paper milestones did Maxvolt achieve in 2026?', 'Five', ['One', 'Three', 'Twelve']),
  q('research', 'Which of the five papers is marked "In press"?', 'The digital traceability system paper', ['The recycling technologies comparison', 'The 6R circular supply chain paper', 'The net-zero conference paper']),
  q('research', 'Where was the net-zero energy systems paper presented?', 'National Institute of Technology, Jalandhar', ['IIT Bombay', 'NIT Trichy', 'BITS Pilani']),
  q('operate', 'Which is the correct order of the end-to-end business model?', 'Source, Design, Make, Distribute, Service, Return', ['Make, Source, Design, Return, Service, Distribute', 'Design, Source, Distribute, Make, Return, Service', 'Source, Make, Design, Service, Distribute, Return']),
  q('operate', 'Which stage of the business model is closed through ReEarth?', 'Return', ['Source', 'Design', 'Distribute']),
  q('operate', 'Which certification covers product safety compliance?', 'AIS 156', ['ISO 9001:2015', 'ISO 14001', 'CE only']),
  q('operate', 'Which certification covers our manufacturing quality management?', 'ISO 9001:2015', ['AIS 156', 'IEC 62133', 'OSHA']),
  q('operate', 'Who must follow safety protocols and wear PPE on the floor?', 'Every employee on the floor', ['Only supervisors', 'Only new joiners', 'Only visitors']),
  q('operate', 'Whose responsibility is quality, according to the deck?', 'Everyone\'s — not only final inspection', ['Only the Quality department', 'Only Production', 'Only the customer']),
  q('fit', 'Who is the Co-Founder & CEO?', 'Satendra Shukla', ['Vishal Gupta', 'Sachin Gupta', 'Pawan Jha']),
  q('fit', 'Who is the Co-Founder, Chairman & Whole-Time Director?', 'Vishal Gupta', ['Bhuvneshwar Pal Singh', 'Mukesh Gupta', 'Narendra Shukla']),
  q('fit', 'Who is the Co-Founder, MD & CFO?', 'Bhuvneshwar Pal Singh', ['Satendra Shukla', 'Sachin Gupta', 'Payal Jain']),
  q('fit', 'Who is the CMO & CHRO (marketing and HR management)?', 'Mukesh Gupta', ['Pawan Jha', 'Narendra Shukla', 'Sachin Gupta']),
  q('fit', 'Who is the Chief Operating Officer?', 'Sachin Gupta', ['Satendra Shukla', 'Vishal Gupta', 'Mukesh Gupta']),
  q('fit', 'Who is the National Sales Head?', 'Pawan Jha', ['Narendra Shukla', 'Payal Jain', 'Bhuvneshwar Pal Singh']),
  q('fit', 'Who is the Lead Research Engineer (next-generation energy storage R&D)?', 'Payal Jain', ['Mukesh Gupta', 'Sachin Gupta', 'Pawan Jha']),
  q('fit', 'Who is the Business Development Head?', 'Narendra Shukla', ['Pawan Jha', 'Satendra Shukla', 'Vishal Gupta']),
  q('fit', 'What does "You are joining one department, but you are joining one company" mean for your work?', 'Your output can affect people and processes outside your own team', ['Your department is independent of others', 'Only your manager sees your work', 'Other departments never depend on you']),
  q('work', 'Which of these is on the zero-tolerance list?', 'Theft or fraud', ['Arriving early', 'Asking questions', 'Working overtime']),
  q('work', 'Where should you report incidents or concerns?', 'Immediately to HR or your supervisor', ['Only on social media', 'Only after a year', 'Nowhere — handle it yourself']),
  q('work', 'What does the Code say about retaliation for good-faith reporting?', 'It is prohibited', ['It is allowed for managers', 'It is encouraged', 'It depends on the department']),
  q('work', 'Which four pillars is our culture built on?', 'Safety, respect, integrity and responsibility', ['Speed, profit, growth and luck', 'Price, volume, brand and reach', 'Fun, free time, rewards and travel']),
  q('hr', 'What are the shift timings mentioned in the deck?', '9:00 AM – 6:00 PM or 10:00 AM – 7:00 PM', ['8:00 AM – 4:00 PM only', '11:00 AM – 8:00 PM only', 'Fully flexible']),
  q('hr', 'How long is the working week?', '6 days', ['4 days', '5 days', '7 days']),
  q('hr', 'Within how many working hours must a missed punch be approved by the manager?', '12 working hours', ['2 working hours', '24 working hours', '1 week']),
  q('hr', 'What happens from the 4th late arrival in a month?', 'A half-day deduction', ['Nothing', 'A written warning only', 'A full-day deduction']),
  q('hr', 'How long is the maternity leave, fully paid?', '26 weeks (8 before + 18 after delivery)', ['12 weeks', '18 weeks in total', '6 months in total']),
  q('hr', 'How many paid calendar days of paternity leave are given to eligible employees?', '15 calendar days', ['3 days', '7 days', '30 days']),
  q('hr', 'After how many years of continuous service is gratuity payable?', '5 years', ['1 year', '2 years', '10 years']),
  q('hr', 'Within how many days must travel and reimbursement claims be submitted on Maxvolt One?', '30 days', ['7 days', '90 days', '1 year']),
  q('hr', 'What do the flexi hours allow for eligible departments and levels?', '±30 minutes, fully compensated the same day', ['Any time, no compensation', '±3 hours', 'Only Saturday timing']),
  q('one', 'How is attendance marked on Maxvolt One where biometric is unavailable?', 'Selfie + GPS', ['Phone call to HR', 'Paper register', 'Email to the manager']),
  q('one', 'Which Maxvolt One feature gives instant, AI-powered policy answers?', 'AskMax', ['Gate Pass', 'My Insurance', 'My Payslips']),
  q('one', 'Which Maxvolt One feature do you use to request premises exit and return?', 'Gate Pass', ['Helpdesk', 'My Training', 'My Performance']),
  q('one', 'Where do you see goals, progress and review history?', 'My Performance', ['My Documents', 'My Payslips', 'Company Policies']),
  q('growth', 'What are the three phases of your first 90 days?', 'Learn & Adapt, Perform & Improve, Own & Contribute', ['Watch, Wait, Wonder', 'Plan, Pause, Prepare', 'Start, Stop, Switch']),
  q('growth', 'Who sets your goals?', 'You, with your Reporting Manager', ['Only HR', 'Only the CEO', 'Nobody']),
  q('growth', 'Which item is on your first-week checklist?', 'Read, understand and sign the Code of Conduct', ['Apply for a transfer', 'Complete the annual appraisal', 'Plan your retirement']),
  q('support', 'Your Buddy at Maxvolt is…', 'A peer, not your manager', ['Your Reporting Manager', 'The HR head', 'A visitor']),
  q('support', 'Where do reimbursement, tax and payroll queries go?', 'Finance', ['IT', 'Admin', 'HR only']),
  q('support', 'Where do hardware, software access and network issues go?', 'IT', ['Finance', 'Admin', 'AskMax']),
  q('support', 'Which Helpdesk category handles facility, travel and stationery?', 'Admin', ['HR', 'Finance', 'IT']),
  q('support', 'Who handles work and performance matters?', 'Your Reporting Manager', ['Your Buddy', 'AskMax', 'The Helpdesk']),
];

const shuffle = (arr, rng) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// n questions spread over the 13 modules (round-robin over shuffled modules), options in random order.
// Returns [{ id, module, text, options[], correct }] — `correct` (index of the right option) stays server-side.
export function makeCourseQuiz({ n = COURSE_QUIZ_QUESTIONS, seed = Date.now(), bank = COURSE_QUESTION_BANK } = {}) {
  const rng = seededRng(seed);
  const by = new Map();
  for (const item of shuffle(bank, rng)) { if (!by.has(item.module)) by.set(item.module, []); by.get(item.module).push(item); }
  const mods = shuffle([...by.keys()], rng);
  const picked = [];
  while (picked.length < Math.min(n, bank.length)) {
    let added = false;
    for (const m of mods) {
      if (picked.length >= n) break;
      const next = by.get(m).shift();
      if (next) { picked.push(next); added = true; }
    }
    if (!added) break;
  }
  return shuffle(picked, rng).map((item, i) => {
    const options = shuffle([item.right, ...item.wrong], rng);
    return { id: `q${i + 1}`, module: item.module, text: item.text, options, correct: options.indexOf(item.right) };
  });
}

// The deck photos are internal (people, events), so they are never served from a public URL: each one is read from
// backend/assets/ld-course and embedded as a data URI in the lesson content that only a signed-in user receives.
const ASSET_DIR = new URL('../assets/ld-course/', import.meta.url);
const _uri = new Map();
export function courseImage(file) {
  if (!_uri.has(file)) {
    let uri = '';
    try { uri = `data:image/webp;base64,${fs.readFileSync(new URL(`${file}.webp`, ASSET_DIR)).toString('base64')}`; } catch { /* missing file: the page shows the caption only */ }
    _uri.set(file, uri);
  }
  return _uri.get(file);
}
const inlineImages = (b) => {
  if (b.t === 'images') return { ...b, items: b.items.map(i => (i.src.startsWith(C) ? { ...i, src: courseImage(i.src.slice(C.length).replace(/\.webp$/, '')) } : i)) };
  if (b.t === 'people') return { ...b, items: b.items.map(x => ({ ...x, photo_src: courseImage(x.photo) })) };
  return b;
};

// Lesson content for the learner (the question bank is never sent to the browser).
export function courseContent() {
  return { updated: COURSE_CONTENT_UPDATED, study_seconds: COURSE_STUDY_SECONDS, modules: COURSE_MODULES.map(m => ({ ...m, blocks: m.blocks.map(inlineImages) })) };
}
