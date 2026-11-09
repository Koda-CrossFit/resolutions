/* Koda Resolutions 2027 — the words and food lists the app shows.
   Edit freely; nothing here is stored per person. Food lists come from the 2026 Official Guide
   (Nutrition Plan 1 = the Resolutions Recommended Plan) and the 2026 Plant Based Guide. */
window.RES27_CONTENT = {
  goals: [
    { id: 'performance', label: 'Performance', blurb: 'Train harder, recover faster, set new PRs.', icon: 'bolt' },
    { id: 'muscle', label: 'Muscle Gain', blurb: 'Build strength and lean muscle.', icon: 'dumbbell' },
    { id: 'fatloss', label: 'Fat Loss', blurb: 'Lose body fat and keep your energy up.', icon: 'flame' },
    { id: 'health', label: 'General Health', blurb: 'Feel better, sleep better, build habits that last.', icon: 'heart' },
  ],

  tracking: [
    { id: 'nutrition', label: 'Follow nutrition plan', sub: 'You’ll pick your plan next', recommended: true, icon: 'plate' },
    { id: 'workout', label: 'Daily workout', sub: 'Koda, Run, Bike, Swim, Walk, Hike, Sports, etc.', recommended: true, icon: 'dumbbell' },
    { id: 'sleep', label: 'Sleep', sub: 'Hit your sleep goal each night', recommended: true, icon: 'moon' },
    { id: 'finishers', label: 'Finisher workouts', sub: 'Short add-on workouts a few times a week', icon: 'bolt' },
    { id: 'hydration', label: 'Hydration', sub: 'Drink your daily water goal', icon: 'drop' },
    { id: 'skill', label: 'CF skill work', sub: 'Practice one CrossFit skill', icon: 'target' },
    { id: 'mobility', label: 'Mobility', sub: 'A few minutes on one area', icon: 'stretch' },
    { id: 'other', label: 'Other', sub: 'A habit of your own', icon: 'star' },
  ],

  plans: [
    { id: 'recommended', label: 'Resolutions Recommended Plan', blurb: 'Our whole-food plan: quality protein, veggies, fruit, smart carbs and healthy fats.', recommended: true, icon: 'plate' },
    { id: 'plant', label: 'Plant Based', blurb: 'Our plant-forward version, with its own food guide.', icon: 'leaf' },
    { id: 'whole30', label: 'Whole30', blurb: 'Remove common trigger foods for 30 days, then bring them back one at a time.', icon: 'reset' },
    { id: 'carnivore', label: 'Carnivore', blurb: 'Animal foods only, to remove plant foods that bother you.', icon: 'steak' },
    { id: 'macros', label: 'Macros', blurb: 'Hit daily protein, carb and fat targets.', icon: 'chart' },
    { id: 'other', label: 'Other', blurb: 'A plan of your own — tell us about it.', icon: 'star' },
  ],

  skillIdeas: ['Double-unders', 'Pull-ups', 'Toes-to-bar', 'Handstand push-ups', 'Muscle-ups', 'Snatch technique', 'Handstand walk', 'Rope climbs'],
  mobilityIdeas: ['Hips', 'Ankles', 'Shoulders', 'Upper back', 'Hamstrings', 'Wrists', 'Overhead position', 'Squat depth'],
  otherIdeas: ['No alcohol', '8,000+ steps', '10 min of reading', 'No phone in bed', '5 min breathwork', 'Get outside', 'Journal 3 lines', 'Protein at every meal'],

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
    { title: 'Add the app to your home screen', text: 'One tap each day, and you stay signed in.' },
    { title: 'Day 1: take before photos', text: 'Front, side and back. Just for you — you’ll thank yourself later.' },
  ],

  steps: [
    { title: 'Tell us your goals', text: 'Pick your focus, your nutrition plan and the habits you want to track.' },
    { title: 'Get your daily checklist', text: 'Your own list of yes-or-no habits, built from your answers.' },
    { title: 'Watch a short video', text: 'A 3–5 minute lesson from our coaches every day.' },
    { title: 'Win with your team', text: 'Join a team, earn points and climb the leaderboard together.' },
  ],

  perks: [
    { icon: 'play', title: 'Daily coaching videos', text: 'Nutrition, sleep, recovery and mindset, one short lesson a day.' },
    { icon: 'check', title: 'Your own checklist', text: 'Built from your goal and the habits you chose.' },
    { icon: 'plate', title: 'Nutrition guides', text: 'Clear food lists for your plan, plus the Koda Cookbook.' },
    { icon: 'users', title: 'A coach and a team', text: 'Rank the coaches you want and compete as a team.' },
    { icon: 'chart', title: 'Track your progress', text: 'Points, streaks and a calendar of your six weeks.' },
    { icon: 'shirt', title: 'Challenge shirt or tank', text: 'Your Resolutions 2027 tee or ladies tank.' },
  ],

  faq: [
    { q: 'What counts as a workout?', a: 'Anything on purpose: a Koda class, a run, bike, swim, walk, hike or sport.' },
    { q: 'I missed a day. Can I fix it?', a: 'Yes. You can change your answers for today and the past {editDays} days.' },
    { q: 'Do I have to track everything?', a: 'No. Your checklist is only what you chose. Change it any time on the Profile tab.' },
    { q: 'How do points work?', a: 'Watching the video is 3 points, each on-plan meal and snacks are 1 point each, a workout is 2, each other habit is 1, and finishers are 2 bonus points each. Some days add a one-time bonus task.' },
    { q: 'Can I have a drink at a party?', a: 'No alcohol on any plan during the challenge. The videos cover how to handle social events.' },
    { q: 'How do I put the app on my phone?', a: 'iPhone: open it in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome, tap the menu, then Add to Home screen.' },
  ],
};
