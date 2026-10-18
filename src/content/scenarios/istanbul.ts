import type { Scenario } from '../../engine/types'

// Дело на английском: закупка линии порошковой покраски у поставщика из Стамбула. Игрок — покупатель.
// Разговор и всё, что звучит за столом, — по-английски; разбор и подсказки — по-русски.
// price    — делимый: евро туда, евро сюда.
// delivery — разменный, важен игроку (цех открывается весной), поставщику почти ничего не стоит:
//            у него на складе почти такая же линия от отменённого заказа.
// payment  — разменный, важен поставщику (за отменённый заказ уже заплачено за горелки и цепь), заводу почти всё равно.
// warranty — разменный, важен поставщику (каждый выезд инженера в Казань — в его план продаж), игроку слегка нужен.
// training — совместимый: оба хотят две недели обучения на месте, но игрок уверен, что поставщик будет экономить.

export const istanbul: Scenario = {
  id: 'istanbul',
  lang: 'en',
  title: 'The Istanbul Line',
  sphere: 'Закупки · English',
  difficulty: 2,
  turnLimit: 12,
  blurb: 'Командировка в Стамбул · переговоры на английском, собеседник говорит с турецким акцентом. Торг с поставщиком линии покраски за чаем с видом на Босфор; разбор и подсказки — по-русски.',
  // В брифе — навыки, без ответов (по-русски: это подсказки для сотрудника, а не слова за столом).
  goals: [
    'Вести торг на английском: называть цифры и условия так, чтобы их поняли однозначно',
    'Не принять первый якорь как точку отсчёта',
    'Найти, что можно разменять, вместо торга за каждый евро',
    'Проверить вопросом то, что «и так понятно» про другую сторону',
  ],
  // А это — ответы, для разбора после встречи.
  lessons: [
    'Называть условия целиком: «€450,000», «30% upfront», «2 weeks on site» — голое число собеседник поймёт по-своему',
    'Не принять первый якорь как точку отсчёта',
    'Найти размен: деньги вперёд поставщику в обмен на поставку за 8 недель вам',
    'Проверить ловушку «поставщик будет экономить на обучении»: Эмре сам хочет учить ваших операторов на месте',
  ],
  issues: [
    { id: 'price', title: 'Price', options: ['€480,000', '€465,000', '€450,000', '€435,000', '€420,000'], kind: 'distributive' },
    { id: 'payment', title: 'Payment', options: ['100% upfront', '70% upfront', '50% upfront', '30% upfront', '10% upfront'], kind: 'integrative' },
    { id: 'delivery', title: 'Delivery', options: ['16 weeks', '14 weeks', '12 weeks', '10 weeks', '8 weeks'], kind: 'integrative' },
    { id: 'warranty', title: 'Warranty', options: ['1 year', '18 months', '2 years', '3 years'], kind: 'integrative' },
    { id: 'training', title: 'Training', options: ['remote training', '1 week on site', '2 weeks on site'], kind: 'compatible' },
  ],
  player: {
    role: 'Procurement engineer at Vodogrey, a water heater plant in the Alabuga SEZ',
    brief:
      'In spring Vodogrey opens a new shop: the plant will paint its own water heater casings instead of buying them ' +
      'painted. The shop needs a powder coating line: a pre-treatment tunnel, a spray booth, a curing oven and an ' +
      'overhead conveyor. Three suppliers sent bids. Your engineers liked Marmara Coating Systems from Istanbul best: ' +
      'solid welding, good references, a sensible oven. So the plant sent you to Istanbul to close the deal. ' +
      'Yesterday you saw their workshop in Tuzla. Today their export sales manager, Emre Kaya, meets you at the sales ' +
      'office in Üsküdar, with the Bosphorus outside the window. Tea comes first, numbers later. The meeting is in English; Emre speaks it with a strong Turkish accent and greets guests in Turkish.\n\n' +
      'What matters to you. Delivery: until the line is running, the plant keeps buying painted casings at a markup, ' +
      'so every week counts. Price: the CFO will see it first. Training: your operators have never worked with powder ' +
      'coating. Suppliers usually charge for every day their engineer spends on site, so expect a push for remote ' +
      'training. A long warranty would be nice, but your maintenance team is strong and the line is built from standard ' +
      'parts. Payment terms matter less: the budget is approved and the money is there.',
    profile: {
      points: {
        price: [0, 8, 16, 24, 32],
        payment: [0, 2, 4, 6, 8],
        delivery: [0, 6, 13, 21, 28],
        warranty: [0, 4, 6, 8],
        training: [0, 12, 24],
      },
      // Циндао: €465,000 (8) + 30% вперёд (6) + 14 недель (6) + 2 года (6) + обучение по видео (0)
      batna: 26,
      batnaText:
        'A supplier from Qingdao offers a similar line for €465,000 with 30% upfront, delivery in 14 weeks, a 2-year warranty and remote training only.',
      interests: [
        { id: 'p_shop', issue: 'delivery', trustToReveal: 0, text: 'until the line runs, we keep buying painted casings at a markup, and the new shop opens in spring' },
        { id: 'p_operators', issue: 'training', trustToReveal: 0, text: 'our operators have never worked with powder coating; without proper training the first months will be rework' },
        { id: 'p_maint', issue: 'warranty', trustToReveal: 0, text: 'our maintenance team is strong and the line uses standard parts, so a long warranty is nice but not critical' },
      ],
    },
  },
  opponent: {
    character: {
      name: 'Emre Kaya',
      short: 'Эмре',
      role: 'export sales manager',
      company: 'Marmara Coating Systems, Istanbul',
      // тёплый по натуре, но на переговорах — деловой: доверие с нуля зарабатывают и у него
      tone: 'neutral',
      portrait: 'emre',
      bio:
        'Forty-two. Grew up in his father\'s sheet-metal workshop in Tuzla and still knows which weld will crack before ' +
        'the customer does. Fifteen years in export sales: Romania, Egypt, Kazakhstan, now Tatarstan. Warm and quick, ' +
        'likes people and a good story, remembers the names of everybody\'s kids, and never lets a guest leave without tea, baklava and a ' +
        'box of lokum. Under the jokes he counts carefully and never gives anything away just because he likes you. ' +
        'Hates being rushed, and hates bluffing about a competitor\'s price: he usually knows it.',
      speech:
        'Lively spoken English, fluent but not native: short sentences, sometimes a slightly unusual word order, ' +
        'no idioms from business books. Uses first names once he knows them; says "my friend" rarely, only when he means ' +
        'it. Thinks out loud with numbers: "eight weeks, okay, but then the oven goes by truck, not by sea". Small stories ' +
        'from the workshop, football and Istanbul traffic instead of arguments. Never "win-win", "I appreciate", ' +
        '"valued partner", "at the end of the day". Moves only for something in return. Now and then, not in every reply, one short ' +
        'Turkish word a guest understands from context, right next to its English meaning: "tamam, okay", "buyurun, please", ' +
        '"çok güzel, very nice".',
      voiceExamples: [
        'Nice words. Now put a number on them.',
        'Sixteen weeks, yes. The oven alone is three weeks of welding.',
        'Okay, okay. You are tougher than my father, and he sold scrap metal.',
        'Let me write this down.',
        'And what do I get back if I move here?',
      ],
      lines: {
        accept: ['Okay. Deal: {offer}. I send the contract tonight.', 'Deal, my friend: {offer}. Let\'s shake on it.'],
        counter: [
          'Look, here is what I can do: {offer}.',
          'Let me count again. {offer}. This works for both of us.',
          'Okay, I can move a little: {offer}.',
        ],
        final: ['We are out of time. My last offer: {offer}. Yes or no?'],
        reveal: ['Okay, I tell you honestly: {interest}.', 'Since you ask directly: {interest}.'],
        no_offer: ['Nice words. And the numbers?', 'I\'m listening. But there is nothing to answer yet.'],
        no_movement: ['We already walked this road. My offer stays, it\'s on the paper in front of you.', 'One more step and I can\'t explain it in Istanbul. The terms stay: {main}.'],
        not_ready_to_reveal: ['That\'s our kitchen, my friend.', 'Too early to look in our books. First let\'s see if we work together at all.'],
        warn_tone: ['Hey. Not like this, please.', 'One more time in this tone and I close my laptop.'],
        walk_away: ['Okay. I think we are done. Good luck with Qingdao.', 'That\'s it for me. This was not a conversation.'],
        player_left: ['Understood. If you change your mind, you have my number.'],
        timeout: ['Time is up. Pity, we were close.'],
      },
    },
    brief:
      'Emre represents an Istanbul maker of coating lines. He wants a higher price, as much money upfront as possible and ' +
      'a short warranty. About his company\'s internal affairs he talks only when he trusts the other side.',
    profile: {
      points: {
        price: [32, 24, 16, 8, 0],
        payment: [24, 18, 12, 6, 0],
        delivery: [8, 6, 4, 2, 0],
        warranty: [20, 14, 7, 0],
        training: [0, 8, 16],
      },
      // Алматы: €435,000 (8) + 10% вперёд (0) + 16 недель (8) + 18 месяцев (14) + обучение по видео (0)
      batna: 30,
      batnaText:
        'A home appliance plant in Almaty wants the same line: €435,000, 10% upfront, delivery in 16 weeks, an 18-month warranty and remote training.',
      interests: [
        {
          id: 'e_training',
          issue: 'training',
          trustToReveal: 50,
          text: 'most warranty calls we get come from operators trained in two days. I would rather send our engineer for two weeks, and I want a plant in Alabuga I can show to the next customer',
        },
        {
          id: 'e_stock',
          issue: 'delivery',
          trustToReveal: 58,
          text: 'we built almost the same line for a customer in Izmir who cancelled in the summer. It stands in our warehouse, and with small changes it can ship in eight weeks. I just don\'t want to give that away for free',
        },
        {
          id: 'e_cash',
          issue: 'payment',
          trustToReveal: 65,
          text: 'for that cancelled order we already paid for the burners and the conveyor chain. Money upfront closes this hole, and for me it is worth more than a few thousand in the price',
        },
        {
          id: 'e_warranty',
          issue: 'warranty',
          trustToReveal: 72,
          text: 'every warranty visit is a flight to Kazan, a hotel and a week of my engineer. Head office counts the warranty reserve against my sales plan, so three years kills my numbers',
        },
        {
          id: 'e_almaty',
          trustToReveal: 85,
          text: 'the plant in Almaty has not paid the deposit. They asked to wait until summer. Without you this line just stands in the warehouse',
        },
      ],
    },
  },
  // Совпадает с тем, что движок кладёт на стол первым ходом: максимум Эмре по всем пунктам, кроме совместимого.
  opening:
    'Hoş geldiniz! Welcome to Istanbul! Buyurun, please, sit. Çay için, drink your tea, it is fresh, and try the baklava, it\'s from the shop downstairs. So. ' +
    'Yesterday you saw our workshop in Tuzla: the tunnel, the booth, the oven. I think you liked it. Our price is ' +
    'four hundred eighty thousand euros, a hundred percent upfront. Delivery in sixteen weeks, one year warranty. ' +
    'Where do we start?',
}
