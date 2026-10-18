import type { Scenario } from '../../engine/types'

// Вторая командировка, финальное дело. Вымышленные компании и учебные условия.
// Партия и валюта фиксированы: это пять пунктов, а не скрытые дополнительные переменные.
export const LAGOS_TERMS =
  'The pilot order is fixed at 100 identical units. All prices are total batch prices in USD, including the agreed freight and insurance budget; the technical specification is already approved. The currency and volume are not negotiable in this meeting. The shipment clock starts when the contract, deposit and any required letter of credit are in place. The quoted weeks mean handover to the sea carrier at the export port. Allow a further four weeks of planned transit to Apapa, Lagos; this is a planning estimate, not a guaranteed arrival date. Meridian arranges Nigerian import clearance and onward haulage. Both parties share the booking and document checklist, with a weekly milestone update.\n\n' +
  'The upfront percentage is negotiable. Any unpaid balance is covered by a confirmed irrevocable USD letter of credit payable at sight against the agreed shipping documents; at 100% upfront no credit is needed. For this exercise both banks have approved that mechanism. Exclusivity covers this product line for one year in the chosen territory. South West means Lagos, Ogun, Oyo, Osun, Ondo and Ekiti; West Africa means Nigeria, Ghana, Benin and Togo only. Renewal requires 300 paid units and a staffed service desk; there is no automatic renewal. Training is included in the batch price: remote, or one or two weeks at Meridian in Lagos. Meridian handles first-line service and spare parts; Volga Process Systems handles manufacturing defects under the already agreed warranty.\n\n'

export const lagos: Scenario = {
  id: 'lagos', lang: 'en', title: 'The Lagos Partnership', sphere: 'Экспорт · Native English', difficulty: 3, turnLimit: 12,
  blurb: 'Командировка в Лагос · переговоры на английском с носителем. Вторая командировка и финальный уровень: экспорт оборудования завода-резидента Алабуги. Разбор и подсказки — по-русски.',
  goals: [
    'Вести деловую встречу на английском с носителем языка',
    'Формулировать пакет условий без двусмысленных цифр',
    'Различать позиции и причины, прежде чем предлагать уступки',
    'Сравнить итоговый пакет со своим запасным вариантом',
  ],
  lessons: [
    'Разделять отгрузку и прибытие: срок в неделях означает передачу груза морскому перевозчику, а не разгрузку в Лагосе',
    'Обменять раннюю отгрузку, доступную заводу, на предоплату, которая финансирует комплектующие',
    'Ограничивать эксклюзивность территорией и измеримыми условиями продления',
    'Проверить общий интерес: обеим сторонам нужна самостоятельная местная сервисная команда, а не зависимость от выездов из России',
  ],
  issues: [
    { id: 'price', title: 'Batch price', options: ['$360,000', '$380,000', '$400,000', '$420,000', '$440,000'], kind: 'distributive' },
    { id: 'delivery', title: 'Shipment deadline', options: ['8 weeks', '10 weeks', '12 weeks', '14 weeks', '16 weeks'], kind: 'integrative' },
    { id: 'payment', title: 'Payment in USD', options: ['10% upfront', '30% upfront', '50% upfront', '70% upfront', '100% upfront'], kind: 'integrative' },
    { id: 'exclusivity', title: 'Distribution exclusivity', options: ['West Africa exclusivity', 'Nigeria-wide exclusivity', 'South West Nigeria exclusivity', 'Non-exclusive distribution'],
      aliases: [['exclusive across west africa'], ['exclusive throughout nigeria', 'exclusive across nigeria', 'exclusivity across nigeria'], ['south west exclusivity', 'south-west nigeria exclusivity'], ['non-exclusive', 'nonexclusive', 'no exclusivity']], kind: 'integrative' },
    { id: 'training', title: 'Service training', options: ['remote training', '1 week on site', '2 weeks on site'], kind: 'compatible' },
  ],
  player: {
    role: 'Export manager at Volga Process Systems, an equipment manufacturer resident in the Alabuga SEZ',
    brief: 'Your factory makes modular industrial water-treatment units. Meridian Industrial Partners wants to distribute them to food processors and light manufacturers in Nigeria. This is your second overseas assignment and your first negotiation with a native English speaker. You are meeting its owner and managing director, Adebayo Adeyemi, at his Victoria Island office in Lagos. The companies and figures in this case are fictional.\n\n' +
      LAGOS_TERMS +
      'Your priorities: protect the batch margin and secure cash for components. A reserved production slot makes early shipment possible without overtime. Broad exclusivity would block other distributors, including promising leads in Ghana. Your engineers want local technicians to work independently, but you suspect a distributor may prefer to pass every service call back to the factory. Find out before conceding.',
    profile: {
      points: { price: [0, 8, 16, 24, 32], delivery: [0, 2, 4, 6, 8], payment: [0, 6, 12, 18, 24], exclusivity: [0, 7, 14, 20], training: [0, 8, 16] },
      // 380k (8) + 14 weeks (6) + 30% (6) + non-exclusive (20) + remote (0).
      batna: 40,
      batnaText: 'An Accra distributor offers $380,000 for the same 100 units, shipment in 14 weeks, 30% upfront with the same USD credit for the balance, non-exclusive distribution and remote training. Freight and other fixed obligations are comparable.',
      interests: [
        { id: 'l_cash', issue: 'payment', trustToReveal: 0, text: 'our component suppliers require deposits; upfront cash protects the production slot' },
        { id: 'l_region', issue: 'exclusivity', trustToReveal: 0, text: 'we already have promising distributor enquiries outside Nigeria, so a broad exclusive territory has a real opportunity cost' },
        { id: 'l_service', issue: 'training', trustToReveal: 0, text: 'a capable local service team prevents repeat faults and expensive emergency travel from the factory' },
      ],
    },
  },
  opponent: {
    character: {
      name: 'Adebayo Adeyemi', role: 'owner and managing director', company: 'Meridian Industrial Partners, Lagos', tone: 'neutral', portrait: 'lagos',
      short: 'Адебайо', nativeEnglish: true,
      bio: 'Forty-five. A Nigerian mechanical engineer who built Meridian with two former colleagues after a decade managing industrial maintenance contracts. English is his first language. He knows his customers by their production problems, reads shipping schedules closely and keeps a notebook of promises made by suppliers. Courteous, measured and good-humoured; he will not confuse a pleasant meeting with a sound contract. His patterned pocket square is a gift from his sister, a textile designer.',
      speech: 'Native, grammatical Nigerian English. Precise business language, natural contractions and occasional understated local phrasing such as "You are welcome" when greeting a guest or "Let us put this properly" when clarifying a package. No pidgin, phonetic accent, broken grammar, caricature or habitual honorifics. Address the guest respectfully, use figures and concrete operational examples. Be warm without automatic agreement. Never switch to Russian. Do not assume nationality determines anyone\'s interests.',
      voiceExamples: ['You are welcome. I hope the journey from the airport was comfortable.', 'Let us put this properly: shipment is not arrival.', 'A territory on paper is only useful if we can support the customers in it.', 'What would you need from us to hold that production slot?', 'I can move on the deposit if the rest of the package makes sense.'],
      lines: {
        accept: ['Agreed: {offer}. I will have our team prepare the contract.', 'That is a workable package: {offer}. Let us put it in writing.'],
        counter: ['Here is the package I can put forward: {offer}.', 'I can move to {offer}. What can you offer in return?'],
        final: ['We need to conclude. My final proposal is {offer}. Can you accept it?'],
        reveal: ['Since you have asked: {interest}.', 'The practical reason is this: {interest}.'],
        no_offer: ['What specific terms are you proposing?', 'I understand the intention. Please put some terms on the table.'],
        no_news: ['Your proposal is on the table. What can you offer in return?', 'I need a change in your proposal before I can revise mine.'],
        no_movement: ['We have covered that ground. My proposal remains unchanged: {main}.', 'Repeating the figure does not change the business case.'],
        not_ready_to_reveal: ['I would rather establish the outline before opening our internal plans.', 'That is commercially sensitive. Let us build a little confidence first.'],
        warn_tone: ['Please keep this professional.', 'I will not continue if we speak to each other like that.'],
        walk_away: ['I am ending this meeting. Our team will pursue the alternative supplier.', 'This conversation is no longer productive. Good afternoon.'],
        player_left: ['Understood. Thank you for coming. You have my contact details.'],
        timeout: ['We have run out of time. I cannot hold the launch plan open indefinitely.'],
      },
    },
    brief: 'Adebayo wants a reliable launch, a competitive batch price and a credible distribution territory. He discusses internal customer commitments only after trust has developed.\n\n' + LAGOS_TERMS,
    profile: {
      points: { price: [32, 24, 16, 8, 0], delivery: [28, 21, 13, 6, 0], payment: [8, 6, 4, 2, 0], exclusivity: [8, 6, 4, 0], training: [0, 12, 24] },
      // 400k (16) + 14 weeks (6) + 10% (8) + non-exclusive (0) + remote (0).
      batna: 30,
      batnaText: 'An alternative manufacturer offers a comparable 100-unit batch for $400,000, shipment in 14 weeks, 10% upfront with the same USD credit for the balance, non-exclusive distribution and remote training.',
      interests: [
        { id: 'a_training', issue: 'training', trustToReveal: 48, text: 'we want our own technicians to resolve faults. Two weeks of hands-on training here would protect our reputation and your equipment; we do not want every service call to become a flight from Russia' },
        { id: 'a_launch', issue: 'delivery', trustToReveal: 56, text: 'two customers have planned commissioning around an early shipment. We have booked warehouse space and a clearing agent at Apapa, but we still need time for transit and customs' },
        { id: 'a_deposit', issue: 'payment', trustToReveal: 64, text: 'our customers have already paid deposits. We can fund a larger advance if your bank documents and shipment milestones are clear' },
        { id: 'a_region', issue: 'exclusivity', trustToReveal: 72, text: 'our service engineers are all based in South West Nigeria. A wider territory looks attractive, but we cannot support it this year; a credible launch matters more' },
        { id: 'a_alternative', trustToReveal: 84, text: 'the alternative supplier meets our minimum specification, but their remote-only training would leave our engineers learning on customer sites' },
      ],
    },
  },
  opening: 'You are welcome to Lagos. Please, have a seat. I have set aside this hour for the pilot order. For the 100 units, I propose $360,000 for the batch, shipment in 8 weeks, 10% upfront and the balance under the confirmed USD letter of credit. I would also like West Africa exclusivity, on the one-year terms in the brief. Shipment means handover to the sea carrier; we must plan the transit to Apapa separately. Where would you like to begin?',
}
