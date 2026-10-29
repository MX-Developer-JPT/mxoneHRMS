// L&D induction step W2 — "Know Our Products, Services & Segments".
// Study material and quiz question bank, written from Maxvolt's own EV and ESS product catalogues and its public website
// (www.maxvoltenergy.com product, about-us and recycle pages), with trade-press coverage for the 2025 smart inverter launch.
// Product photos are from the same catalogues (maxvolt-hr/public/ld-products). Checked October 2026.
// HR / L&D: review against the current catalogue before relying on it — model lists and numbers change, and where the
// catalogues and website disagree on a figure (capacity, partner counts) the figure is left out on purpose.
// Pure data + logic (no database), unit-tested in backend/tests/ldProducts.test.mjs.
import { seededRng, PRODUCT_STUDY_SECONDS, PRODUCT_QUIZ_QUESTIONS } from './ldOpening.js';

export { PRODUCT_STUDY_SECONDS, PRODUCT_QUIZ_QUESTIONS };
export const PRODUCT_CONTENT_UPDATED = '2026-10';

const IMG = '/ld-products/';
const im = (file, caption) => ({ src: `${IMG}${file}.webp`, caption });
const sec = (id, title, intro, points, facts = [], images = [], source = '') => ({ id, title, intro, points, facts, images, source });

export const PRODUCT_SECTIONS = [
  sec('company', 'Maxvolt at a glance',
    'Maxvolt Energy Industries Limited is an Indian lithium battery manufacturer, founded in 2019 in Ghaziabad, Uttar Pradesh, and listed on the NSE SME Emerge platform in 2025.',
    [
      'We started with a 15-batteries-a-day line. Today we make lithium batteries for electric scooters, e-motorcycles, e-cycles, e-rickshaws and e-autos, plus energy storage systems, inverters and electronic gadgets.',
      'Manufacturing runs from two facilities in Ghaziabad (about 80,000 sq. ft. in total) with 300+ professionals; a large lithium battery recycling plant is being developed at Aligarh.',
      'Our business has two broad segments — electric mobility, and energy storage — and a third strand, recycling, under the Extended Producer Responsibility (EPR) model: manufacture, repurpose and recycle.',
      'Reach: 100+ OEM partners, 950+ dealers and a distributor network, with an on-site service support network covering 1,100+ pincodes and a 100% buy-back assurance on EV batteries.',
      'Our own R&D centre (set up in 2022) works on battery packs and Battery Management Systems (BMS).',
      'Mission: reliable and innovative lithium solutions, certified quality (AIS 156, ISO 9001:2015) and a sustainable future. Vision: reduce carbon footprints, empower clean urban transport and integrate renewable energy.',
    ],
    [['Founded', '2019, Ghaziabad (UP)'], ['Listing', 'NSE SME Emerge, 2025'], ['Certified', 'AIS 156 · ISO 9001:2015'], ['Recycling arm', 'Maxvolt ReEarth']],
    [im('plant-ghaziabad', 'Maxvolt manufacturing facility, Ghaziabad'), im('plant-floor', 'Inside the plant')],
    'EV & ESS catalogues · maxvoltenergy.com/about-us'),

  sec('segments', 'Segments and customers we serve',
    'Know who buys from us — it decides which product you talk about.',
    [
      'E-rickshaw and e-loader owners and fleets — rugged, fast-charging, long-life packs. Our volume product is the LiFePO4 e-rickshaw battery.',
      'E-scooter, e-bike and delivery riders, and two-wheeler manufacturers (OEMs) — light, energy-dense packs in the Premium and ECO series.',
      'E-cycle makers and riders — compact 36V packs.',
      'Homes, offices, showrooms and shops with power cuts — lithium inverter batteries and energy storage inverters. Homes with rooftop solar — solar batteries.',
      'Telecom towers, server rooms, diesel-generator back-up, solar plants, factories and data centres — rack-type battery energy storage systems (BESS).',
      'Medical equipment makers, solar street-light and signage makers, robotics, drones, power-tool and gadget makers — medical, solar and custom lithium packs.',
      'Dealers, distributors and OEM partners — our channel and our largest customers.',
    ],
    [], [im('hero-escooter', 'E-mobility'), im('home-solar-battery', 'Home solar storage'), im('datacentre-use', 'Data centres and server rooms')]),

  sec('escooter', 'E-scooter and e-bike batteries — Premium and ECO series',
    'Lithium-ion packs for electric two-wheelers, from personal scooters to delivery fleets, sold in two series.',
    [
      'Premium Series: high-mileage packs — 48V (29/34/40Ah), 63V (29/34/40Ah) and 74V (29/34/40Ah) — for long range on a single charge and steady speed.',
      'ECO Series: value packs — 48V (25/29Ah), 60V (25/29/34/40Ah) and 74V (25/29Ah).',
      'Common features: stylish detachable metal case, full charge in about 4 hours, same port for charging and discharging, silent operation, light and compact, water resistant, warranty support, wide temperature range.',
      'Smart Bluetooth connect: monitor battery health, warranty status, voltage and more on a smartphone.',
      'Active equalizer for equal charge across cells (longer life) and advanced fire-safety / overheating protection. Rated life: up to about 4 years.',
      'Model codes start with MEILES — for example MEILES48029 is a 48V 29Ah scooter pack. Certified AIS 156 and made in an ISO 9001:2015 plant.',
    ],
    [['Voltages', '48V · 60V · 63V · 74V'], ['Capacities', '25Ah to 40Ah'], ['Series', 'Premium · ECO'], ['Charge time', '≈ 4 hours']],
    [im('pack-escooter', 'E-scooter battery pack'), im('hero-escooter', 'Pack with an electric scooter')]),

  sec('erickshaw', 'E-rickshaw batteries',
    'Our volume product: heavy-duty LiFePO4 packs that replace lead-acid in passenger and cargo e-rickshaws.',
    [
      'Voltages and capacities: 51.2V (100/150/200Ah), 64V (100/150Ah) and 74V (100/150Ah). Model codes start MEILRE — e.g. MEILRE51100.',
      'LFP (LiFePO4) cells — safe and long-lived: 2,000+ deep cycles on the 51.2V range (the website quotes 5+ years of daily running; the catalogue says up to about 4 years).',
      'Fast charge in about 2–4 hours, with separate charging and discharging ports and a battery status meter.',
      'About 80% lighter than acid batteries and takes about 80% less space. No acid spillage, water topping or terminal maintenance; zero pollution.',
      'Stylish metal case, silent operation, active equalizer, fire safety, Bluetooth monitoring of health, warranty and voltage, wide temperature range. Certified AIS 156 and ISO 9001:2015.',
    ],
    [['Voltages', '51.2V · 64V · 74V'], ['Capacities', '100Ah · 150Ah · 200Ah'], ['Chemistry', 'LiFePO4 (LFP)'], ['Model codes', 'MEILRE…']],
    [im('hero-erickshaw', 'Maxvolt e-rickshaw battery'), im('pack-erickshaw', 'The 51.2V pack')]),

  sec('ecycle', 'E-cycle batteries',
    'Compact 36V lithium packs for electric bicycles.',
    [
      'Three capacities — 7.5Ah, 10Ah and 15Ah — at 36V, weighing about 4 kg, 5 kg and 7 kg. Model codes start MEILEC36… (the website lists them as MEIPLEC-36…).',
      'Soft Pack for slim frames and Hard Pack for rack mounting. Full charge in under 3–4 hours; no lead or acid; AIS 156 certified.',
      'Same smart features as the other EV packs: battery management, active equalizer, fire safety and Bluetooth monitoring.',
      'Used for commuting, last-mile connectivity, campus mobility, rentals and delivery e-cycles; supported by the dealer network. Real range depends on rider weight, terrain and assist level.',
    ],
    [['Voltage', '36V'], ['Capacities', '7.5Ah · 10Ah · 15Ah'], ['Model codes', 'MEILEC36014 / 36018 / 36022'], ['Formats', 'Soft Pack · Hard Pack']],
    [im('hero-ecycle', 'E-bike with a Maxvolt pack'), im('pack-ecycle', 'E-cycle lithium battery')]),

  sec('inverter_battery', 'Home inverter batteries',
    'The lithium replacement for the lead-acid battery behind a home, office or showroom inverter.',
    [
      'LiFePO4 chemistry. Range: 12.8V (100/150/200/300Ah), 25.6V (100/150/200Ah), 48V (100/150Ah) and 51.2V (100/150Ah) — from 1.28 kWh to 7.68 kWh. Model codes start MEILIV.',
      'Full charge in about 4 hours (lead-acid takes 8–12), up to 10 years of life with 3,000+ cycles, zero maintenance, light and compact — a 12.8V 100Ah pack weighs about 12–14 kg.',
      'Smart BMS protects against overcharge, over-discharge, short circuit and high temperature, and the app shows charge level, health and estimated backup time.',
      'Customisable size and shape. Used in homes, offices and showrooms, shops, rural off-grid power, telecom and medical backup.',
    ],
    [['Voltages', '12.8V · 25.6V · 48V · 51.2V'], ['Capacities', '100Ah to 300Ah'], ['Life', 'Up to 10 years · 3,000+ cycles'], ['Charge time', '≈ 4 hours']],
    [im('home-inverter-battery', 'Inverter battery in a home'), im('home-solar-battery', 'Battery with a rooftop-solar home')]),

  sec('inverters', 'Energy storage inverters and the smart lithium inverter series',
    'Pure sine-wave inverters that work with our lithium batteries — and, since 2025, a wall-mountable smart lithium inverter with the battery built in.',
    [
      'Catalogue energy-storage inverters: 1.2 kW (VS1512/24AP5, 24V), 3 kW (FC3812/24/48, 12/24/48V) and 5 kW (VS6348 M8, 48V) — 220V input, pure sine wave, wall-mount compatible, compact and light.',
      'They accept lithium or lead batteries, can run up to 9 units in parallel, restart automatically when mains returns, and have a cooling system, solar charging (up to 60A / 120A on the larger models) and protections: overload, short circuit, low voltage, anti-reverse connection and input over-current fuse.',
      'The Smart Lithium Inverter Series (launched August 2025) combines the inverter and a lithium battery in one wall-mountable unit, in 12V, 24V and 48V variants with ratings of 1.2, 3, 5 and 6.2 kW — for homes, shops and commercial solar.',
      'A Hybrid Inverter Series that works with lithium and lead batteries has followed.',
    ],
    [['Ratings', '1.2 kW · 3 kW · 5 kW · 6.2 kW'], ['Output', 'Pure sine wave'], ['Parallel', 'Up to 9 units'], ['Batteries', 'Lithium or lead']],
    [im('inverter-1', 'Energy storage inverter'), im('inverter-2', 'Wall-mount inverter'), im('inverter-3', 'Higher-power inverter')]),

  sec('bess', 'Energy storage: single batteries and rack-type BESS',
    'Battery energy storage systems for solar plants, telecom towers, diesel-generator back-up, server rooms, factories and large homes.',
    [
      'LiFePO4 modules in 48V, 96V and 120V classes. Single batteries: 48V 100Ah (4.8 kWh, 60 kg), 96V 100Ah (9.6 kWh, 110 kg) and 120V 100Ah (12 kWh, 150 kg).',
      'Rack-type systems scale by adding modules in a cabinet: 48V (200–300Ah), 96V (200–500Ah) and 120V (200–500Ah), up to 60 kWh in one configuration. Energy storage packs can be customised from 12V to 480V and 86Ah to 500Ah.',
      'Cycle life of 3,500+ at 80% depth of discharge, over 95% round-trip efficiency, fast charging, water resistance, zero maintenance and up to 10 years of life; cloud-connected smart BMS with remote monitoring.',
      'Works with solar, diesel generators and the grid. Applications: telecom towers, diesel-generator replacement, server rooms and data centres, solar plants, rooftop solar, EV-charging buffer storage.',
      'Certified AIS 156, IEC 62619 and ISO 9001:2015. Each project is sized and engineered for the customer\'s load.',
    ],
    [['Voltage classes', '48V · 96V · 120V'], ['Largest rack', '120V 500Ah = 60 kWh'], ['Cycle life', '3,500+ at 80% DoD'], ['Chemistry', 'LiFePO4']],
    [im('storage-single-battery', 'Single storage battery'), im('rack-cabinet', 'Rack-type cabinet'), im('rack-cabinet-site', 'Cabinet installed at a site')]),

  sec('special', 'Solar street-light, medical and portable batteries',
    'Smaller lithium packs for special applications, all from the catalogue.',
    [
      'Solar street light batteries (12V and 24V, 12–60Ah): long life (up to 10 years), fast recharge after sunlight, water resistant, customisable size and shape — used in street lights, speed signs and cameras, SOS call booths.',
      'Medical device batteries (12V and 24V, 12–80Ah): built to high safety standards, compact, long life, reliable — used for endoscopy systems, respiratory and ultrasound equipment and wheelchairs.',
      'Portable / gadget batteries (3.7V to 14.8V, 1,000–2,600mAh and larger): for robots, toys, drones, power tools, routers, CCTV cameras and other rechargeable electronics — light, fast-charging and customisable.',
      'Chargers: lithium and lead battery chargers for 36V–72V e-scooter packs in a range of current ratings (from 2A up to 25A).',
    ],
    [['Street light', '12V / 24V · 12–60Ah'], ['Medical', '12V / 24V · 12–80Ah'], ['Gadgets', '3.7V–14.8V'], ['Chargers', '36V–72V · 2A–25A']],
    [im('solar-street-light', 'Solar street-light / signage'), im('medical-use', 'Medical equipment'), im('custom-packs', 'Portable and gadget packs'), im('charger-1', 'Battery charger')]),

  sec('custom', 'Custom lithium packs and OEM supply',
    'If a customer needs something we do not list, we engineer it.',
    [
      'Process: engineering consultation → prototype → small-batch run → mass production.',
      'Customisable: voltage (about 3.7V to 120V — and up to 480V for storage systems), capacity (1Ah to 500Ah), cell format, application-specific smart BMS, medical-grade and industrial-grade options, and white-label branding for OEMs.',
      'Used in medical devices, industrial automation and robotics, power tools, specialty EVs, consumer electronics and IoT, drones and agriculture, telecom backup and defence.',
      'Pricing, MOQ and lead time are quoted per project — send the enquiry to sales through Request a Quote or the company contact line.',
    ], [], [im('gadget-pack', 'A custom lithium pack')]),

  sec('services', 'Services around the product',
    'What we offer besides the battery.',
    [
      'On-site service support network covering 1,100+ pincodes, service centres and doorstep service; 100% buy-back assurance on EV batteries.',
      'Dealer and distributor programme (Become a Dealer / Find a Dealer), with distribution points and service centres in Lucknow, Delhi NCR, Patna, Indore, Ahmedabad, Mumbai, Raipur and Kolkata.',
      'In-house R&D, custom pack engineering and BMS research (including collaboration with IIT Roorkee); bulk OEM supply with custom specifications and delivery schedules.',
      'Sizing help: the battery calculator and product comparison tools on the website, quotes and support through Contact and FAQ. For storage projects: help from sizing through commissioning and after-sales service.',
      'Recycling and end-of-life take-back through Maxvolt ReEarth.',
    ], [], [im('charger-2', 'Chargers')]),

  sec('reearth', 'Maxvolt ReEarth — responsible recycling (EPR)',
    'Our recycling initiative, so used lithium batteries are reused and not dumped.',
    [
      'Why it matters: India produces roughly 50,000 tonnes of lithium battery waste a year, rising about 30% annually; unrecycled batteries can contaminate soil and water.',
      'Process: (1) collection and drop points with stockists, dealers and customers → (2) safe, government-compliant logistics → (3) pre-sorting, separating reusable cells, BMS and electrical parts for secondary use → (4) material recovery, dismantling into powder to extract lithium, cobalt, nickel, copper and more → (5) reuse in industries such as wire manufacturing and electronics → (6) lower landfill and mining.',
      'Catalogue impact claims: about 85% raw-material recovery and 60% energy saving compared with new extraction. Goals for 2030: help recycle 500,000 batteries a year through 100+ collection centres across India.',
      'The large-scale recycling plant at Aligarh is still being developed, so describe it as growing capacity — never promise a customer a specific pickup date.',
    ],
    [['Subsidiary', 'Maxvolt ReEarth'], ['Chemistries', 'LFP · NMC · NCA · LCO'], ['2030 goal', '500,000 batteries a year']], [im('plant-floor', 'Our plant floor')]),

  sec('quality', 'Quality, safety and standards',
    'The words customers and auditors ask about.',
    [
      'AIS 156 — Government of India safety standard for EV batteries; our EV packs are certified (Phase 1 and 2).',
      'ISO 9001:2015 — our quality management system. IEC 62619 — safety standard for industrial lithium batteries, listed for our storage products.',
      'Protections built into EV packs: fire resistant, active equalization, water resistant, air-release vent, short-circuit, high-temperature, over-current and over-charge / over-discharge protection, plus vibration control.',
      'Every pack has a smart BMS that protects and balances the cells. Never promise a customer something outside the product specification (voltage, current, temperature range).',
    ]),

  sec('chemistry', 'Why lithium, and LFP versus NMC',
    'The two questions every customer asks.',
    [
      'Versus lead-acid: lithium is about 80% lighter and takes far less space, charges in hours instead of many hours, lasts several times more cycles, needs no maintenance and gives usable power until nearly empty.',
      'LiFePO4 (LFP): very safe and thermally stable, long cycle life — the choice for e-rickshaws, inverter batteries and storage.',
      'NMC / lithium-ion: higher energy density — more range from a smaller, lighter pack — the choice for scooters and e-bikes where weight and space matter.',
      'Quick maths: energy (Wh) = voltage × capacity (Ah). A 51.2V 100Ah pack holds about 5.1 kWh.',
    ]),

  sec('guide', 'Which product for which customer?',
    'A quick guide for your first conversations.',
    [
      'E-rickshaw owner who wants more life and faster charging → 51.2V / 64V / 74V LFP e-rickshaw battery.',
      'Scooter or delivery-bike rider, or a two-wheeler OEM → Premium or ECO series e-scooter pack.',
      'Home, office or shop with power cuts → lithium inverter battery, plus an energy storage inverter or a smart lithium inverter.',
      'Rooftop solar, telecom tower, server room, factory or data centre → solar battery / rack-type BESS, sized to the load.',
      'Medical equipment, street lights, drones, robots or other special equipment → medical, solar or custom lithium packs.',
      'Old batteries to dispose of → Maxvolt ReEarth recycling.',
    ]),
];

// ── question bank ────────────────────────────────────────────────────────
// q(topic, question, right answer, three wrong answers)
const q = (topic, text, right, wrong) => ({ topic, text, right, wrong });
export const PRODUCT_QUESTION_BANK = [
  q('company', 'In which year was Maxvolt Energy founded?', '2019', ['2012', '2016', '2022']),
  q('company', 'In which state is Maxvolt\'s manufacturing based?', 'Uttar Pradesh (Ghaziabad)', ['Maharashtra (Pune)', 'Telangana (Hyderabad)', 'Tamil Nadu (Chennai)']),
  q('company', 'On which stock exchange platform is Maxvolt listed?', 'NSE SME Emerge', ['BSE Main Board', 'NSE Main Board only', 'It is not listed']),
  q('company', 'Which two certifications appear on every Maxvolt catalogue?', 'AIS 156 and ISO 9001:2015', ['ISO 14001 and OHSAS 18001', 'CE and RoHS only', 'UL 9540 and FCC']),
  q('company', 'Which three activities does Maxvolt\'s EPR model combine?', 'Manufacturing, repurposing and recycling', ['Mining, refining and export', 'Trading, leasing and franchising', 'Retail, banking and insurance']),
  q('company', 'What does the 100% buy-back assurance on the EV catalogue cover?', 'EV batteries', ['Only mobile phones', 'Only chargers', 'Only solar panels']),
  q('company', 'Roughly how many pincodes does Maxvolt\'s on-site service support network cover?', '1,100+', ['50', '250', '11']),
  q('segments', 'Which customer group is the 51.2V LiFePO4 battery mainly built for?', 'E-rickshaw owners and fleets', ['Smartphone users', 'Diesel truck fleets', 'Airline operators']),
  q('segments', 'Rack-type BESS is most suited to which customers?', 'Telecom towers, server rooms and factories', ['School students', 'Two-wheeler riders', 'Bicycle shops']),
  q('segments', 'A customer needs a battery for ultrasound equipment. What should you offer?', 'A medical-device lithium battery', ['A 51.2V e-rickshaw battery', 'A 74V e-scooter pack', 'A rack-type BESS']),
  q('segments', 'Through whom do we mainly reach home, driver and small-business customers locally?', 'Our dealer and distributor network', ['Only direct online sales', 'Government tenders only', 'Street vendors']),
  q('escooter', 'Which two series does the Maxvolt e-scooter battery range come in?', 'Premium and ECO', ['Gold and Silver', 'Home and Office', 'Lite and Max']),
  q('escooter', 'Which voltages appear in the Premium series for e-scooters?', '48V, 63V and 74V', ['12V, 24V and 36V', '96V, 120V and 240V', '5V, 9V and 12V']),
  q('escooter', 'What does the prefix "MEILES" in a model code such as MEILES48029 stand for?', 'E-scooter packs', ['E-rickshaw packs', 'Inverter batteries', 'E-cycle packs']),
  q('escooter', 'What does the Smart Bluetooth feature on EV packs let a user do?', 'Monitor battery health, warranty and voltage on a phone', ['Play music', 'Start the vehicle remotely', 'Order a new battery']),
  q('escooter', 'What does the active equalizer in an EV pack do?', 'Keeps charge equal across cells for longer life', ['Makes the pack heavier', 'Switches the lights on', 'Cools the road']),
  q('escooter', 'Which standard certifies our EV battery packs for safety in India?', 'AIS 156', ['ISI 1234', 'BIS 5', 'IS 9001']),
  q('erickshaw', 'What chemistry do Maxvolt e-rickshaw batteries use?', 'LiFePO4 (LFP)', ['Lead-acid', 'Nickel-cadmium', 'Alkaline']),
  q('erickshaw', 'Which is a standard e-rickshaw battery voltage from Maxvolt?', '51.2V', ['12.8V', '36V', '3.7V']),
  q('erickshaw', 'What does the prefix "MEILRE" in a model code stand for?', 'E-rickshaw packs', ['E-scooter packs', 'Inverter batteries', 'Gadget batteries']),
  q('erickshaw', 'Compared with an acid battery, a Maxvolt e-rickshaw lithium battery is about…', '80% lighter and takes 80% less space', ['Twice as heavy', 'The same weight', 'Larger and needs water']),
  q('erickshaw', 'Which is a benefit of lithium over lead-acid for an e-rickshaw?', 'No water topping or acid spillage', ['It needs weekly water topping', 'It is heavier', 'It charges slower']),
  q('ecycle', 'What is the nominal voltage of the Maxvolt e-cycle battery?', '36V', ['12V', '51.2V', '120V']),
  q('ecycle', 'Which two physical formats do e-cycle packs come in?', 'Soft Pack and Hard Pack', ['Box and PVC', 'Rack and floor', 'Cylinder and brick']),
  q('inverter_battery', 'How long does a home inverter lithium battery take to charge fully?', 'About 4 hours', ['About 30 minutes', 'About 24 hours', 'It cannot be recharged']),
  q('inverter_battery', 'Up to how many years of life is claimed for the inverter and storage batteries?', 'Up to 10 years', ['Up to 1 year', 'Up to 2 years', 'No life is claimed']),
  q('inverter_battery', 'What does the prefix "MEILIV" in a model code stand for?', 'Lithium inverter batteries', ['E-rickshaw batteries', 'E-cycle packs', 'Custom packs']),
  q('inverter_battery', 'How can a customer see charge level and estimated backup time of an inverter battery?', 'In the mobile app, through the smart BMS', ['Only by opening the battery', 'By calling the dealer each day', 'It cannot be monitored']),
  q('inverters', 'How many of our energy storage inverters can run in parallel?', 'Up to 9 units', ['Only 1', 'Up to 2', 'Unlimited with no checks']),
  q('inverters', 'What is special about the Smart Lithium Inverter Series?', 'The lithium battery is built into the wall-mountable inverter', ['It has no battery at all', 'It only works with lead-acid batteries', 'It is a portable phone charger']),
  q('inverters', 'What type of output waveform do Maxvolt energy storage inverters give?', 'Pure sine wave', ['Square wave only', 'Triangular wave', 'Direct current only']),
  q('inverters', 'Which battery types can the catalogue inverters work with?', 'Lithium or lead', ['Only lead', 'Only lithium', 'Neither']),
  q('bess', 'What are the voltage classes of our solar battery / rack-type systems?', '48V, 96V and 120V', ['3.7V and 7.4V', '12V and 24V only', '400V and 800V']),
  q('bess', 'Roughly how large can one rack-type storage configuration get?', 'Up to 60 kWh', ['Up to 600 Wh', 'Up to 5 kWh', 'Only 1 kWh']),
  q('bess', 'What does BESS stand for?', 'Battery Energy Storage System', ['Basic Electric Supply Setup', 'Battery Export Safety Standard', 'Best Energy Saving System']),
  q('bess', 'Which cycle life is quoted for our storage products at 80% depth of discharge?', '3,500+ cycles', ['100 cycles', '500 cycles', '1,000 cycles']),
  q('bess', 'Which of these is an application shown for energy storage batteries?', 'Telecom tower and server room back-up', ['Mobile phone case', 'Wrist watch', 'Toy car track']),
  q('special', 'Which applications are shown for Maxvolt medical-device batteries?', 'Endoscopy, respiratory, ultrasound and wheelchairs', ['Hair dryers and mixers', 'Lawn mowers', 'Bicycle bells']),
  q('special', 'Which of these is powered by Maxvolt solar street-light batteries?', 'Street lights, speed signs and SOS call booths', ['Only washing machines', 'Cars engines', 'Elevators']),
  q('custom', 'What is the usual order of the custom battery process?', 'Consultation, prototype, small batch, mass production', ['Mass production, then consultation', 'Shipping, then design', 'Pricing only, no engineering']),
  q('custom', 'Which of these can a customer customise in a custom pack?', 'Voltage, capacity, BMS and branding', ['Only the colour', 'Nothing', 'Only the invoice date']),
  q('services', 'Which online tool helps a customer choose the right battery size?', 'The battery calculator', ['The weather page', 'The careers page', 'The investor page']),
  q('services', 'Which of these is a Maxvolt service?', 'Service centres with doorstep service', ['Home loans', 'Air tickets', 'Mobile phone repair']),
  q('reearth', 'Which metals can our recycling process recover from used batteries?', 'Lithium, cobalt, nickel and copper', ['Only gold', 'Only aluminium', 'Only plastic']),
  q('reearth', 'What is the correct order of the recycling process?', 'Collect, transport, pre-sort, recover materials, reuse', ['Shred, collect, sell as scrap', 'Recover, collect, ignore', 'Process, discard, collect']),
  q('reearth', 'What is Maxvolt\'s 2030 recycling goal?', 'Help recycle 500,000 batteries a year', ['Recycle 50 batteries a year', 'Close all collection centres', 'No recycling target']),
  q('quality', 'What does the BMS (Battery Management System) do?', 'Protects the cells and balances them', ['Makes the battery heavier', 'Pays the electricity bill', 'Paints the casing']),
  q('quality', 'Which standard describes our quality management system?', 'ISO 9001:2015', ['AIS 156', 'IEC 62619', 'ISO 14001:2004']),
  q('chemistry', 'Which chemistry is known for very good safety and long cycle life?', 'LiFePO4 (LFP)', ['Every chemistry equally', 'Lead-acid', 'Zinc-carbon']),
  q('chemistry', 'Why do scooters and e-bikes mainly use NMC / lithium-ion cells?', 'Higher energy density gives more range from a lighter pack', ['NMC is cheaper than all chemistries', 'NMC never heats up', 'Scooters need acid']),
  q('chemistry', 'A pack is 51.2V and 100Ah. About how much energy does it hold?', 'About 5.1 kWh', ['About 51 Wh', 'About 500 kWh', 'About 0.5 kWh']),
  q('guide', 'A home owner with rooftop solar wants storage. Which is the best starting point?', 'Solar battery or smart lithium inverter, sized to the load', ['E-rickshaw battery', 'E-cycle pack', 'Nothing — solar needs no storage']),
  q('guide', 'A customer wants to dispose of used batteries responsibly. Whom do you point them to?', 'Maxvolt ReEarth recycling', ['The nearest bin', 'Burning them', 'Keeping them at home']),
];

const shuffle = (arr, rng) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Pick n questions spread across the topics (round-robin over shuffled topics), with options in random order.
// Returns [{ id, topic, text, options[], correct }] — `correct` is the index of the right option (kept server-side).
export function makeProductQuiz({ n = PRODUCT_QUIZ_QUESTIONS, seed = Date.now(), bank = PRODUCT_QUESTION_BANK } = {}) {
  const rng = seededRng(seed);
  const byTopic = new Map();
  for (const item of shuffle(bank, rng)) { if (!byTopic.has(item.topic)) byTopic.set(item.topic, []); byTopic.get(item.topic).push(item); }
  const topics = shuffle([...byTopic.keys()], rng);
  const picked = [];
  while (picked.length < Math.min(n, bank.length)) {
    let added = false;
    for (const tp of topics) {
      if (picked.length >= n) break;
      const next = byTopic.get(tp).shift();
      if (next) { picked.push(next); added = true; }
    }
    if (!added) break;
  }
  return shuffle(picked, rng).map((item, i) => {
    const options = shuffle([item.right, ...item.wrong], rng);
    return { id: `q${i + 1}`, topic: item.topic, text: item.text, options, correct: options.indexOf(item.right) };
  });
}

// Study content for the learner (no answers in here — the bank itself is never sent to the browser).
export function productTrainingContent() {
  return { updated: PRODUCT_CONTENT_UPDATED, study_seconds: PRODUCT_STUDY_SECONDS, sections: PRODUCT_SECTIONS };
}
