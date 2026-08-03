// One-click use-case documents. Each is fictional on purpose: a general chatbot
// has never seen these, so a correct answer can only come from retrieval, not
// from the model's memory. That is the whole point of grounded RAG, made visible
// in one click. Every sample's last question is designed to fall outside the
// document, so the visitor also sees the system refuse rather than guess.

export interface Sample {
  id: string;
  /** Short button label. */
  label: string;
  /** Source name shown as the active corpus. */
  title: string;
  /** One-line description of the use case. */
  blurb: string;
  text: string;
  /** Tailored questions; the final one is meant to land outside the document. */
  questions: string[];
}

export const SAMPLES: Sample[] = [
  {
    id: "handbook",
    label: "Company policy",
    title: "Northwind Labs — Employee Handbook (excerpt)",
    blurb: "An internal HR policy no public model was trained on.",
    text: `Northwind Labs Employee Handbook — Time Off and Working Arrangements (excerpt)

Paid time off. Full-time employees accrue 18 days of paid time off (PTO) per year during their first two years, rising to 24 days from the third year onward. PTO begins accruing on the first day of employment, but no PTO may be taken during the first 90 days. Unused PTO of up to 5 days may be carried into the following calendar year; anything above that is forfeited on December 31.

Sick leave is separate from PTO. Employees receive 10 paid sick days per year, which do not carry over.

Remote work. Northwind Labs operates on a hybrid schedule. Employees are expected to work from the office on Tuesdays and Thursdays, and may work remotely on the other three weekdays. Fully remote arrangements require director approval and are reviewed every six months.

Equipment and expenses. The company provides a laptop and covers one external monitor up to a value of 350 dollars. Employees working remotely may claim a one-time home-office stipend of 500 dollars within their first 60 days. Software subscriptions must be approved by a manager before purchase and reimbursed through the monthly expense report, which is due by the fifth of each month.

Working hours. Core collaboration hours are 10am to 4pm in the employee's local time zone. Outside of core hours, employees may arrange their own schedule, provided deliverables are met.`,
    questions: [
      "How many PTO days do employees get in their first year?",
      "Can I work from home on a Tuesday?",
      "How much can I expense for a monitor?",
      "What is the parental leave policy?",
    ],
  },
  {
    id: "agreement",
    label: "Service contract",
    title: "Acme Cloud — Master Service Agreement (excerpt)",
    blurb: "Contract terms where a wrong answer has real consequences.",
    text: `Acme Cloud Master Service Agreement — Service Levels and Term (excerpt)

Availability. Acme Cloud commits to a monthly uptime of 99.9 percent for the Standard plan and 99.95 percent for the Enterprise plan, measured as the percentage of minutes in the calendar month in which the service is reachable, excluding scheduled maintenance.

Service credits. If monthly uptime falls below the committed level, the customer is eligible for service credits against the following month's fees: a credit of 10 percent for uptime between 99.0 and 99.9 percent, 25 percent for uptime between 95.0 and 99.0 percent, and 50 percent for uptime below 95.0 percent. Credits must be requested in writing within 30 days of the affected month and are the customer's sole remedy for downtime.

Support. Standard plan customers receive email support with a response target of one business day. Enterprise customers receive 24/7 support with a response target of one hour for critical issues.

Term and termination. The initial term is 12 months and renews automatically for successive 12-month terms unless either party gives written notice of non-renewal at least 30 days before the end of the current term. Either party may terminate for material breach that remains uncured 15 days after written notice.

Fees. Fees are billed annually in advance and are non-refundable except where these service credits apply.`,
    questions: [
      "What uptime does the Enterprise plan guarantee?",
      "What service credit applies if uptime is 96 percent?",
      "How much notice do I need to give to cancel?",
      "How much does the Enterprise plan cost?",
    ],
  },
  {
    id: "study",
    label: "Research paper",
    title: "Midday Light & Alertness — Randomized Trial (summary)",
    blurb: "A study's specific findings, cited instead of paraphrased from memory.",
    text: `Effect of a Brief Midday Light Exposure on Afternoon Alertness in Office Workers: A Randomized Trial (summary)

Background. Afternoon drops in alertness are common among office workers and are often attributed to circadian and post-lunch effects. Bright light exposure has been proposed as a low-cost countermeasure.

Methods. We conducted a randomized controlled trial with 144 office workers at a single site. Participants were randomly assigned to either a 20-minute exposure to bright light (10,000 lux) between 1:00 and 1:30 pm, or to a control condition of ordinary office lighting (about 300 lux), on five consecutive workdays. The primary outcome was self-reported alertness at 3:00 pm on a standardized 1-to-10 scale. Reaction time on a computerized task was a secondary outcome.

Results. The bright-light group reported higher afternoon alertness than the control group, with a mean difference of 1.4 points on the 10-point scale (p = 0.002). Mean reaction time was 26 milliseconds faster in the bright-light group, though this secondary result did not reach statistical significance (p = 0.08). No adverse effects were reported.

Limitations. The trial ran at a single site over one week, self-reported alertness is subjective, and the study was not blinded, since participants were aware of their lighting condition. The authors call for larger, multi-site trials before drawing firm conclusions.

Conclusion. A brief midday exposure to bright light modestly improved self-reported afternoon alertness in this sample, but the evidence is preliminary.`,
    questions: [
      "How many participants were in the study?",
      "What was the main result, and was it statistically significant?",
      "Was the reaction-time improvement significant?",
      "Did the study measure sleep quality?",
    ],
  },
];
