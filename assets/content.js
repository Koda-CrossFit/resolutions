/* Koda Resolutions 2027 — the gyms, words and food lists the app shows.
   Edit freely; nothing here is stored per person. Food lists come from the 2026 Official Guide
   (Nutrition Plan 1 = the Resolutions Recommended Plan) and the 2026 Plant Based Guide. */
window.RES27_CONTENT = {
  /*
   * The six Koda gyms (Kevin, 11/23/2026: the challenge runs at all six, with "a different color
   * scheme" for each; "The current website should be Iron View's colors"). Ids, names, short names
   * and cities match RES27_GYMS in apps-script/Resolutions27.js, in the same order (a unit test checks).
   * Each gym's coaches, ways to pay, price and contact come from the Gyms tab of the sheet; these are
   * the parts the app needs before the server answers.
   * - label: the gym's full name on its landing page (Iron View's is the one it always had).
   * - swatch: [dark, brand], the gym's colors as a small chip (gym picker, gym standings, Profile).
   * - light / dark: the theme's colors, taken from each gym's own website: Iron View navy and silver
   *   (the app's own :root colors, unchanged), OKC black and purple, Native black, pink and slate
   *   blue, Norman black and crimson, Downtown black and green, Tulsa teal and light grey. Text on a
   *   brand color is at least 4.5:1 (black text on the light pink, green and teal; white on the rest).
   *   --yes (a chosen Yes, a done day) is the gym's color, except Norman's: its near-black (a light
   *   grey in dark mode), since its crimson looked like the checklist's red No. --yes-edge, when set,
   *   outlines a chosen Yes instead of --line (review, 11/23/2026).
   *   They are the same values as the :root[data-gym] rules in assets/app.css, which the page uses;
   *   tests/e2e.js checks that the two match, so change both together.
   * - gymNeutrals: the grey scale the five black-and-color gyms share (Iron View keeps its navy greys).
   */
  gymNeutrals: {
    light: {
      '--bg': '#f3f3f5', '--surface': '#ffffff', '--surface-2': '#f7f7f8', '--surface-3': '#efeff2', '--border': '#e4e4e8', '--border-strong': '#d2d2d8',
      '--text': '#121215', '--muted': '#5d5d68', '--subtle': '#686873', '--no': '#ebebef', '--on-no': '#45454f', '--silver-200': '#e4e4e8',
      '--silver-300': '#d2d2d8', '--silver-400': '#aaaab4',
    },
    dark: {
      '--bg': '#09090b', '--surface': '#131316', '--surface-2': '#18181c', '--surface-3': '#1e1e23', '--border': '#28282e', '--border-strong': '#36363e',
      '--text': '#ececf0', '--muted': '#a5a5b0', '--subtle': '#85858f', '--no': '#232329', '--on-no': '#bebec8', '--silver-200': '#36363e',
    },
  },
  gyms: [
    {
      id: 'ironview', name: 'Koda Iron View', short: 'Iron View', city: 'Louisville, CO', address: '740 S Pierce Ave #5, Louisville, CO 80027', tz: 'America/Denver',
      label: 'Koda CrossFit Iron View', swatch: ['#0c1a2b', '#c9d1da'],
      light: {
        '--navy-950': '#070f1a', '--navy-900': '#0c1a2b', '--navy-850': '#112237', '--navy-800': '#152a43', '--navy-700': '#1d3654', '--navy-600': '#2a4769',
        '--brand': '#0c1a2b', '--brand-2': '#1d3654', '--brand-hover': '#1d3654', '--on-brand': '#ffffff', '--line': '#0c1a2b', '--accent': '#aeb7c2',
        '--focus': 'rgba(29, 54, 84, 0.35)', '--yes': '#0c1a2b', '--on-yes': '#ffffff',
        '--silver-sheen': 'linear-gradient(135deg, #f6f8fa 0%, #dde2e8 45%, #f3f5f8 70%, #cfd6de 100%)', '--on-sheen': '#0c1a2b', '--avatar-bg': '#0c1a2b',
        '--hero-a': '#24405f', '--hero-b': '#132539', '--hero-c': '#0b1726', '--lhero-a': '#2a4769', '--lhero-b': '#15283f', '--lhero-c': '#0a1522',
        '--hero-dim': '#aeb7c2', '--metal': 'linear-gradient(180deg, #ffffff 0%, #c4ccd5 60%, #9aa5b1 100%)',
        '--chip': 'linear-gradient(135deg, #f4f6f9, #c9d1da)', '--on-chip': '#0c1a2b', '--ring-b': '#b9c2cc',
        '--bar': 'linear-gradient(90deg, #cfd6de, #ffffff)',
      },
      dark: {
        '--brand': '#e6ebf0', '--brand-2': '#c9d1da', '--brand-hover': '#c9d1da', '--on-brand': '#0c1a2b', '--line': '#e6ebf0',
        '--focus': 'rgba(201, 209, 218, 0.35)', '--yes': '#dfe5eb', '--on-yes': '#0c1a2b',
        '--silver-sheen': 'linear-gradient(135deg, #1a2a3e 0%, #24384f 50%, #182739 100%)', '--on-sheen': '#e9eef4', '--avatar-bg': '#24384f',
      },
    },
    {
      id: 'okc', name: 'Koda OKC', short: 'OKC', city: 'Oklahoma City, OK', address: '7016 Ozzy Ave, Oklahoma City, OK 73105', tz: 'America/Chicago',
      label: 'Koda CrossFit OKC', swatch: ['#0e0b14', '#7c28e6'],
      light: {
        '--navy-950': '#060509', '--navy-900': '#0e0b14', '--navy-850': '#15111d', '--navy-800': '#1c1627', '--navy-700': '#2a1f3d', '--navy-600': '#3b2b57',
        '--hero-a': '#2f1a52', '--hero-b': '#140d21', '--hero-c': '#07050b', '--lhero-a': '#3d2070', '--lhero-b': '#180f29', '--lhero-c': '#060409',
        '--hero-dim': '#c4a5f3', '--metal': 'linear-gradient(180deg, #ffffff 0%, #dccafb 60%, #b48cf5 100%)',
        '--chip': 'linear-gradient(135deg, #efe6fe, #c9adf6)', '--on-chip': '#1d0f33', '--ring-b': '#b48cf5',
        '--bar': 'linear-gradient(90deg, #9d5cf5, #e3d4fd)', '--brand': '#7c28e6', '--brand-2': '#6a1fcb', '--brand-hover': '#6a1fcb', '--on-brand': '#ffffff',
        '--line': '#7c28e6', '--accent': '#8146af', '--focus': 'rgba(124, 40, 230, 0.28)', '--yes': '#7c28e6', '--on-yes': '#ffffff',
        '--silver-sheen': 'linear-gradient(135deg, #f8f4fe 0%, #e7dcfa 45%, #f6f1fd 70%, #dccdf6 100%)', '--on-sheen': '#1d0f33', '--avatar-bg': '#0e0b14',
      },
      dark: {
        '--brand': '#7c28e6', '--brand-2': '#b794f6', '--brand-hover': '#8a3ef0', '--on-brand': '#ffffff', '--line': '#a370f7', '--accent': '#a370f7',
        '--focus': 'rgba(183, 148, 246, 0.35)', '--yes': '#7c28e6', '--on-yes': '#ffffff',
        '--silver-sheen': 'linear-gradient(135deg, #1e1829 0%, #2a2139 50%, #1b1625 100%)', '--on-sheen': '#ececf0', '--avatar-bg': '#3b2b57',
      },
    },
    {
      id: 'native', name: 'Koda Native', short: 'Native', city: 'Bethany, OK', address: '4310 N Martin Ave, Building A, Bethany, OK 73008', tz: 'America/Chicago',
      label: 'Koda CrossFit Native', swatch: ['#111114', '#fab1d8'],
      light: {
        '--navy-950': '#070708', '--navy-900': '#111114', '--navy-850': '#18181c', '--navy-800': '#1f1f24', '--navy-700': '#2e2a31', '--navy-600': '#423a43',
        '--hero-a': '#3a2131', '--hero-b': '#161014', '--hero-c': '#070607', '--lhero-a': '#4a2a3d', '--lhero-b': '#1a1217', '--lhero-c': '#070607',
        '--hero-dim': '#fab1d8', '--metal': 'linear-gradient(180deg, #ffffff 0%, #fdd6ea 60%, #fab1d8 100%)',
        '--chip': 'linear-gradient(135deg, #fde3f0, #fab1d8)', '--on-chip': '#121215', '--ring-b': '#fab1d8',
        '--bar': 'linear-gradient(90deg, #fab1d8, #fde3f0)', '--brand': '#fab1d8', '--brand-2': '#4b6886', '--brand-hover': '#f79bcb', '--on-brand': '#121215',
        '--line': '#c4407f', '--accent': '#6888a7', '--focus': 'rgba(250, 177, 216, 0.55)', '--yes': '#fab1d8', '--on-yes': '#121215',
        '--silver-sheen': 'linear-gradient(135deg, #fff6fa 0%, #fbe1ee 45%, #fff3f9 70%, #f6d3e5 100%)', '--on-sheen': '#121215', '--avatar-bg': '#111114',
      },
      dark: {
        '--brand': '#fab1d8', '--brand-2': '#fab1d8', '--brand-hover': '#fcc8e3', '--on-brand': '#121215', '--line': '#fab1d8', '--accent': '#8fa9c4',
        '--focus': 'rgba(250, 177, 216, 0.35)', '--yes': '#fab1d8', '--on-yes': '#121215',
        '--silver-sheen': 'linear-gradient(135deg, #261b21 0%, #33232c 50%, #22181e 100%)', '--on-sheen': '#ececf0', '--avatar-bg': '#4a2a3d',
      },
    },
    {
      id: 'norman', name: 'Koda Norman', short: 'Norman', city: 'Norman, OK', address: '1210 McGee Dr, Norman, OK 73069', tz: 'America/Chicago',
      label: 'Koda CrossFit Norman', swatch: ['#120c0c', '#891c1a'],
      light: {
        '--navy-950': '#080505', '--navy-900': '#120c0c', '--navy-850': '#1a1111', '--navy-800': '#221616', '--navy-700': '#3a1a19', '--navy-600': '#55201e',
        '--hero-a': '#4d1514', '--hero-b': '#1c0c0b', '--hero-c': '#080404', '--lhero-a': '#63191a', '--lhero-b': '#200d0c', '--lhero-c': '#080404',
        '--hero-dim': '#f0a3a1', '--metal': 'linear-gradient(180deg, #ffffff 0%, #f6cfce 60%, #e8908d 100%)',
        '--chip': 'linear-gradient(135deg, #fbe5e4, #f0a3a1)', '--on-chip': '#2a0b0a', '--ring-b': '#f0a3a1',
        '--bar': 'linear-gradient(90deg, #d4403b, #f6cfce)', '--brand': '#891c1a', '--brand-2': '#891c1a', '--brand-hover': '#a32420', '--on-brand': '#ffffff',
        '--line': '#891c1a', '--accent': '#c8322e', '--focus': 'rgba(137, 28, 26, 0.28)', '--yes': '#120c0c', '--on-yes': '#ffffff', '--yes-edge': '#120c0c',
        '--silver-sheen': 'linear-gradient(135deg, #fbf5f5 0%, #f1dfde 45%, #fbf3f3 70%, #ead2d1 100%)', '--on-sheen': '#2a0b0a', '--avatar-bg': '#120c0c',
      },
      dark: {
        '--brand': '#b3261e', '--brand-2': '#f08a87', '--brand-hover': '#c42c24', '--on-brand': '#ffffff', '--line': '#e0524e', '--accent': '#e0524e',
        '--focus': 'rgba(240, 138, 135, 0.35)', '--yes': '#efe7e7', '--on-yes': '#120c0c', '--yes-edge': '#efe7e7',
        '--silver-sheen': 'linear-gradient(135deg, #271a1a 0%, #352222 50%, #231717 100%)', '--on-sheen': '#ececf0', '--avatar-bg': '#55201e',
      },
    },
    {
      id: 'downtown', name: 'Koda Downtown', short: 'Downtown', city: 'Austin, TX', address: '', tz: 'America/Chicago',
      label: 'Koda CrossFit Downtown', swatch: ['#0d110e', '#00ad40'],
      light: {
        '--navy-950': '#050706', '--navy-900': '#0d110e', '--navy-850': '#131915', '--navy-800': '#19211b', '--navy-700': '#1c3a27', '--navy-600': '#245236',
        '--hero-a': '#0f3d22', '--hero-b': '#0b1710', '--hero-c': '#040705', '--lhero-a': '#13502c', '--lhero-b': '#0c1b12', '--lhero-c': '#040705',
        '--hero-dim': '#5fd98c', '--metal': 'linear-gradient(180deg, #ffffff 0%, #c2f2d3 60%, #4fd17f 100%)',
        '--chip': 'linear-gradient(135deg, #d9f7e4, #6fe09a)', '--on-chip': '#04210f', '--ring-b': '#4fd17f',
        '--bar': 'linear-gradient(90deg, #00ad40, #b8f0cc)', '--brand': '#00ad40', '--brand-2': '#007a2d', '--brand-hover': '#00c24a', '--on-brand': '#000000',
        '--line': '#008a33', '--accent': '#00ad40', '--focus': 'rgba(0, 173, 64, 0.3)', '--yes': '#00ad40', '--on-yes': '#000000',
        '--silver-sheen': 'linear-gradient(135deg, #f3fcf6 0%, #dcf3e4 45%, #f1fbf4 70%, #cdebd8 100%)', '--on-sheen': '#0d110e', '--avatar-bg': '#0d110e',
      },
      dark: {
        '--brand': '#00ad40', '--brand-2': '#3fd477', '--brand-hover': '#19c257', '--on-brand': '#000000', '--line': '#00ad40', '--accent': '#00ad40',
        '--focus': 'rgba(0, 173, 64, 0.35)', '--yes': '#00ad40', '--on-yes': '#000000',
        '--silver-sheen': 'linear-gradient(135deg, #16231b 0%, #1d3025 50%, #142019 100%)', '--on-sheen': '#ececf0', '--avatar-bg': '#1c3a27',
      },
    },
    {
      id: 'tulsa', name: 'Koda Tulsa', short: 'Tulsa', city: 'Tulsa, OK', address: '1141 S Frankfort Ave, Tulsa, OK 74104', tz: 'America/Chicago',
      label: 'Koda CrossFit Tulsa', swatch: ['#062626', '#02afad'],
      light: {
        '--navy-950': '#031414', '--navy-900': '#062626', '--navy-850': '#083030', '--navy-800': '#0b3a3a', '--navy-700': '#0e4b4a', '--navy-600': '#11605e',
        '--hero-a': '#0b5554', '--hero-b': '#073b3b', '--hero-c': '#031a1a', '--lhero-a': '#0d5c5b', '--lhero-b': '#084343', '--lhero-c': '#031a1a',
        '--hero-dim': '#9fe8e6', '--metal': 'linear-gradient(180deg, #ffffff 0%, #d3f4f3 60%, #8ae2e0 100%)',
        '--chip': 'linear-gradient(135deg, #fafafa, #dcdcdc)', '--on-chip': '#141414', '--ring-b': '#8ae2e0',
        '--bar': 'linear-gradient(90deg, #02afad, #c9f1f0)', '--brand': '#02afad', '--brand-2': '#00706f', '--brand-hover': '#14c3c1', '--on-brand': '#000000',
        '--line': '#00807e', '--accent': '#02afad', '--focus': 'rgba(2, 175, 173, 0.32)', '--yes': '#02afad', '--on-yes': '#000000',
        '--silver-sheen': 'linear-gradient(135deg, #f7f7f7 0%, #e6e6e6 45%, #f4f4f4 70%, #dadada 100%)', '--on-sheen': '#141414', '--avatar-bg': '#062626',
      },
      dark: {
        '--brand': '#02afad', '--brand-2': '#3fd3d0', '--brand-hover': '#22c6c4', '--on-brand': '#000000', '--line': '#02afad', '--accent': '#02afad',
        '--focus': 'rgba(2, 175, 173, 0.38)', '--yes': '#02afad', '--on-yes': '#000000',
        '--silver-sheen': 'linear-gradient(135deg, #1c2222 0%, #263030 50%, #1a1f1f 100%)', '--on-sheen': '#ececf0', '--avatar-bg': '#0e4b4a',
      },
    },
  ],

  goals: [
    { id: 'performance', label: 'Performance', blurb: 'Train harder, recover faster, set new PRs.', icon: 'bolt' },
    { id: 'muscle', label: 'Muscle Gain', blurb: 'Build strength and lean muscle.', icon: 'dumbbell' },
    { id: 'fatloss', label: 'Fat Loss', blurb: 'Lose body fat and keep your energy up.', icon: 'flame' },
    { id: 'health', label: 'General Health', blurb: 'Feel better, sleep better, build habits that last.', icon: 'heart' },
  ],

  // Every habit gets a Yes or No at sign-up; the recommended ones start on Yes.
  tracking: [
    { id: 'nutrition', label: 'Follow nutrition plan', sub: 'You’ll pick your plan next', recommended: true, icon: 'plate' },
    { id: 'workout', label: 'Daily workout', sub: 'Koda Workout, Run, Bike, Swim, Walk, Hike, Sports, etc.', recommended: true, icon: 'dumbbell' },
    { id: 'sleep', label: 'Sleep', sub: 'Hit your sleep goal each night', recommended: true, icon: 'moon' },
    { id: 'protein', label: 'Daily protein minimum', sub: 'Hit your protein goal every day', icon: 'protein' },
    { id: 'hydration', label: 'Hydration', sub: 'Drink your daily water goal', icon: 'drop' },
    { id: 'finishers', label: 'Finisher workouts', sub: 'Short add-on workouts, 1 to 3 a week', icon: 'bolt' },
    { id: 'skill', label: 'Skill work', sub: 'Practice one skill, like double-unders or pull-ups', icon: 'target' },
    { id: 'mobility', label: 'Mobility', sub: 'Focused improvement in one area', icon: 'stretch' },
    { id: 'recovery', label: 'Recovery', sub: 'Cold plunge, sauna, massage or another recovery session', icon: 'recovery' },
    { id: 'other', label: 'Other', sub: 'A habit of your own', icon: 'star' },
  ],

  plans: [
    { id: 'recommended', label: 'Resolutions Recommended Plan', blurb: 'Our whole-food plan: quality protein, veggies, fruit, smart carbs and healthy fats.', recommended: true, icon: 'plate' },
    { id: 'macros', label: 'Macros', blurb: 'Hit daily protein, carb and fat targets.', icon: 'chart' },
    { id: 'plant', label: 'Plant Based', blurb: 'Our plant-forward version, with its own food guide.', icon: 'leaf' },
    { id: 'whole30', label: 'Whole30', blurb: 'Remove common trigger foods for 30 days, then bring them back one at a time.', icon: 'reset' },
    { id: 'carnivore', label: 'Carnivore', blurb: 'Animal foods only, to remove plant foods that bother you.', icon: 'steak' },
    { id: 'other', label: 'Other', blurb: 'A plan of your own — tell us about it.', icon: 'star' },
  ],

  skillIdeas: ['Double-unders', 'Pull-ups', 'Toes-to-bar', 'Handstand push-ups', 'Muscle-ups', 'Snatch technique', 'Handstand walk', 'Rope climbs'],
  mobilityIdeas: ['Hips', 'Ankles', 'Shoulders', 'Upper back', 'Hamstrings', 'Wrists', 'Overhead position', 'Squat depth'],
  otherIdeas: ['No alcohol', '8,000+ steps', '10 min of reading', 'No phone in bed', '5 min breathwork', 'Get outside', 'Journal 3 lines', 'Gratitude: 3 things'],

  avoidAll: [
    { title: 'Alcohol', text: 'No alcohol of any kind during the challenge.' },
    { title: 'Added sugar', text: 'No refined sugar, syrup, or artificial sweeteners.' },
    { title: 'Processed foods', text: 'No refined sugar, artificial ingredients, or packaged snacks.' },
    { title: 'Vegetable oils', text: 'No canola, soybean, sunflower and other vegetable oils.' },
  ],

  guides: {
    recommended: {
      title: 'Resolutions Recommended Plan',
      intro: 'Build every meal from the approved list. Quantities matter too — the daily videos cover how much to eat for your goal.',
      approved: [
        { cat: 'Protein', items: ['Beef', 'Pork', 'Chicken', 'Turkey', 'Duck', 'Fowl', 'Fish', 'Seafood', 'Shellfish', 'Eggs', 'Bacon', 'Whey protein'], fine: 'No sugars, nitrates, or celery salt.' },
        { cat: 'Vegetables', items: ['Most veggies', 'Most winter squashes', 'Sweet potatoes', 'Yams', 'White potatoes'] },
        { cat: 'Fruits & nuts', items: ['Lemon / lime juice', 'All fruits', 'Most nuts and seeds', 'Nut butters'] },
        { cat: 'Grains', items: ['White rice', 'Oatmeal', 'Couscous', 'Quinoa'] },
        { cat: 'Legumes', items: ['Green beans', 'Snow peas', 'Snap peas'] },
        { cat: 'Beverages', items: ['Water', 'Tea', 'Coffee', 'Kombucha (low sugar)', 'Coconut water', 'Vegetable juice (low sugar)', 'Almond milk (no added sugar or vegetable oils)'] },
        { cat: 'Fats & oils', items: ['Olive oil', 'Coconut oil', 'Avocado oil', 'Pork fat (lard)', 'Beef fat (tallow)', 'Duck fat', 'Nut oils', 'Flaxseed oil', 'Avocados', 'Coconuts', 'Olives', 'Butter', 'Palm oil'] },
      ],
      unapproved: [
        { cat: 'Protein', items: ['Deli meats with ingredients other than meat, water and salt'] },
        { cat: 'Fruits & nuts', items: ['Dried fruit with added sugar', 'Peanuts', 'Peanut butter'] },
        { cat: 'Grains', items: ['Corn tortillas', 'Buckwheat', 'Amaranth', 'Pasta or noodles of any kind (bean, rice, quinoa)', 'Barley', 'Farro', 'Cereal', 'Flour of any grain (rice, quinoa, corn, wheat)', 'Bread', 'Bagels', 'Muffins', 'Tortillas', 'Ezekiel bread', 'Brown rice', 'Sourdough'] },
        { cat: 'Beans & soy', items: ['Beans and legumes (except green beans, snow peas and snap peas)', 'Soy: tempeh, miso, edamame, tofu'] },
        { cat: 'Beverages', items: ['Wine & spirits', 'Beer', 'Fruit juice', 'Milk', 'Oat milk', 'Soda (regular & diet)'] },
        { cat: 'Fats & oils', items: ['Industrial vegetable & seed oils: canola, corn, peanut, safflower, soy, sunflower'] },
        { cat: 'Dairy', items: ['Milk', 'Cheese', 'Cream', 'Yogurt', 'Kefir', 'Cottage cheese'] },
        { cat: 'Sweets', items: ['White / brown sugar', 'Agave', 'Other sweeteners', 'Desserts', 'Candy & sweets'] },
      ],
    },
    plant: {
      title: 'Plant Based Guide',
      intro: 'Same principles, built around plant proteins. Eggs and fish are optional. Quantities still matter — the videos cover how much to eat for your goal.',
      approved: [
        { cat: 'Proteins', items: ['Beans and other legumes (lentils, chickpeas) — preferably soaked or sprouted', 'Fermented soy (tempeh, miso)', 'Soy', 'Eggs (optional)', 'Fish (optional)', 'Whey or pea protein powder'] },
        { cat: 'Vegetables', items: ['Veggies', 'Winter squashes', 'Sweet potatoes', 'Yams', 'White potatoes', 'Corn'] },
        { cat: 'Grains', items: ['Rice (white, brown, wild)', 'Oats / oatmeal', 'Quinoa', 'Corn tortillas', 'Amaranth', 'Buckwheat'] },
        { cat: 'Dairy', items: ['Butter', 'Yogurt', 'Kefir', 'Whey protein', 'Cottage cheese'] },
        { cat: 'Fats & oils', items: ['Olive oil', 'Coconut oil', 'Avocado oil', 'Pork fat (lard)', 'Beef fat (tallow)', 'Duck fat', 'Nut oils', 'Flaxseed oil', 'Avocados', 'Coconuts', 'Olives', 'Butter', 'Palm oil'] },
        { cat: 'Fruits & nuts', items: ['Lemon / lime juice', 'All fruits', 'All nuts and seeds', 'Nut butters'] },
        { cat: 'Beverages', items: ['Water', 'Tea', 'Coffee', 'Kombucha', 'Coconut water', 'Vegetable juice'] },
      ],
      moderation: [
        { cat: 'In moderation', items: ['Dried fruit (no added sugar)', 'Baked sweet potatoes', 'Baked veggie “fries” / chips (approved oils)', 'Baked white potato “fries”'] },
      ],
      unapproved: [
        { cat: 'Fruits & nuts', items: ['Dried fruit with added sugar', 'Peanuts', 'Peanut butter'] },
        { cat: 'Fats & oils', items: ['Industrial vegetable & seed oils: canola, corn, peanut, safflower, soy, sunflower'] },
        { cat: 'Dairy', items: ['Milk', 'Cheese', 'Cream', 'Buttermilk', 'Sour cream', 'Casein protein'] },
        { cat: 'Grains', items: ['Pasta or noodles of any kind (bean, rice, quinoa)', 'Couscous', 'Barley', 'Farro', 'Cereal', 'Flour of any grain (rice, quinoa, wheat)', 'Bread', 'Bagels', 'Muffins', 'Tortillas', 'Ezekiel bread'] },
        { cat: 'Sweets', items: ['White / brown sugar', 'Maple syrup', 'Agave', 'Honey', 'Stevia', 'Monk fruit', 'Other sweeteners', 'Desserts, candy & sweets', 'All added sugars'] },
        { cat: 'Beverages', items: ['Wine & spirits', 'Beer', 'Fruit juice', 'Milk', 'Soda (regular & diet)'] },
      ],
    },
  },

  otherPlans: {
    whole30: {
      title: 'Whole30',
      body: [
        'Whole30 has its own official rules — use <a href="https://whole30.com" target="_blank" rel="noopener">whole30.com</a> as your food list.',
        'The short version: 30 days without added sugar, alcohol, grains, most legumes and dairy, then bring foods back one at a time to see how each one makes you feel.',
        'Our “avoid on all plans” list still applies.',
      ],
    },
    carnivore: {
      title: 'Carnivore',
      body: [
        'Animal foods only: beef, pork, lamb, chicken, fish, seafood and eggs. Many people also keep butter.',
        'Choose meats with nothing added (no sugar, nitrates or celery salt) and skip processed meats.',
        'Our “avoid on all plans” list still applies. Check with your coach (and your doctor if you have a health condition) before you start.',
      ],
    },
    macros: {
      title: 'Macros',
      body: [
        'Track what you eat in an app like MyFitnessPal, Cronometer or MacroFactor and aim for your daily protein, carb and fat targets.',
        'Food quality still counts: build meals from the Recommended Plan’s approved foods when you can.',
        'Our “avoid on all plans” list still applies. Want help setting your numbers? Ask your coach.',
      ],
    },
    other: {
      title: 'Your own plan',
      body: [
        'You’ll follow the plan you described when you signed up. Your coach will check in on how it’s going.',
        'Our “avoid on all plans” list still applies.',
      ],
    },
  },

  tips: {
    performance: [
      'Eat a real meal 2–3 hours before you train, with both carbs and protein.',
      'Put most of your carbs around your workouts — before and after.',
      'Get 20–40 g of protein within a couple of hours after training.',
      'Sleep is your best recovery tool. Protect 7–9 hours.',
      'Sip water all day, not just at the gym. Add electrolytes on long or sweaty sessions.',
      'Feeling flat in workouts? Add carbs before you cut anything else.',
    ],
    muscle: [
      'Aim for about 0.8–1 g of protein per pound of bodyweight each day.',
      'Spread protein over 3–4 meals of 30–50 g each.',
      'Muscle needs fuel: don’t fear the extra serving of rice or potatoes.',
      'Add a little weight or one more rep each week.',
      'Muscle is built while you sleep. Get 7–9 hours.',
      'Weigh in weekly. If the trend isn’t climbing slowly, add a snack.',
    ],
    fatloss: [
      'Build every plate around protein and vegetables first.',
      'Portions by hand: a palm of protein, a fist of veggies, a cupped hand of carbs, a thumb of fat.',
      'Eat slowly and stop at about 80% full.',
      'Liquid calories add up fast — stick to water, tea and black coffee.',
      'Walk more. Daily steps burn more than you think.',
      'The scale bounces day to day. Watch the weekly trend.',
    ],
    health: [
      'Eat a mix of colorful vegetables every day.',
      'Get outside in the morning light — it helps you sleep at night.',
      'Keep a steady bedtime, even on weekends.',
      'Move every day, even if it’s a walk.',
      'Cook at home more nights than not.',
      'Pick one habit you’ll keep after the challenge and write it down.',
    ],
  },

  getReady: [
    { title: 'Read your nutrition guide', text: 'It’s on the Nutrition tab, built for the plan you picked.', link: '#/nutrition' },
    { title: 'Clear out the pantry', text: 'Move anything that isn’t on your plan out of sight (or out of the house).' },
    { title: 'Plan and shop for Week 1', text: 'Pick 3–4 go-to meals. The Koda Cookbook has member favorites.', cookbook: true },
    { title: 'Book your InBody scan', text: 'Optional, but it’s the best way to see your results. Ask a coach at Koda.' },
    { title: 'Add the app to your home screen', text: 'One tap each day. Sign in once in the home-screen app and it remembers you.' },
    { title: 'Day 1: take before photos', text: 'Front, side and back. Just for you — you’ll thank yourself later.' },
  ],

  steps: [
    { title: 'Tell us your goals', text: 'Pick your focus, your nutrition plan and the habits you want to track.' },
    { title: 'Get your daily checklist', text: 'Your own list of yes-or-no habits, built from your answers.' },
    { title: 'Watch a short video', text: 'A 3–5 minute lesson from our coaches every day.' },
    { title: 'Community', text: 'Use the Koda community for motivation and accountability.' },
  ],

  perks: [
    { icon: 'play', title: 'Daily coaching videos', text: 'Nutrition, sleep, recovery and mindset, one short lesson a day.' },
    { icon: 'check', title: 'Your own checklist', text: 'Built from your goal and the habits you chose.' },
    { icon: 'plate', title: 'Nutrition guides', text: 'Clear food lists for your plan, plus the Koda Cookbook.' },
    { icon: 'users', title: 'Support and guidance', text: 'Get matched up with a coach for support and guidance throughout the challenge.' },
    { icon: 'trophy', title: 'Track your progress', text: 'A daily score out of 10, your streak, and live team standings.' },
    { icon: 'shirt', title: 'Challenge shirt or tank', text: 'Your Resolutions 2027 tee or ladies tank.' },
  ],

  faq: [
    { q: 'What counts as a workout?', a: 'Anything on purpose: a Koda class, a run, bike, swim, walk, hike or sport.' },
    { q: 'I missed a day. Can I fix it?', a: 'Yes. You can enter or change your scores for any day of the week until {openDay} at midnight{timeZone}. That’s when we pull the week’s scores, and we tally them up {tallyDay} morning. A day you haven’t filled in shows as Overdue on your Today screen: tap it and answer each habit.' },
    { q: 'Do I have to track everything?', a: 'No. Your checklist is only what you chose, and every day is still scored out of 10. Change it any time on the Profile tab.' },
    { q: 'How do points work?', a: 'Every day is scored out of 10, however many habits you track. Nutrition counts the most: breakfast, lunch, dinner and snacks (or no snacks) each count. A workout and sleep each count half as much as nutrition, and the video and every other habit a quarter as much. Finishers count on the days you do them, and any you miss from your weekly goal count against that Sunday. A bonus task adds 1 extra point on top.' },
    { q: 'Can I have a drink at a party?', a: 'No alcohol on any plan during the challenge. The videos cover how to handle social events.' },
    { q: 'How do I put the app on my phone?', a: 'iPhone: open it in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome, tap the menu, then Add to Home screen.' },
  ],
};
