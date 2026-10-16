/** Prebuilt job descriptions to start a hiring drive from (A-9). The AI still analyses and proposes the configuration. */
export interface DriveTemplate {
  id: string;
  title: string;
  group: string;
  jd: string;
}

export const DRIVE_TEMPLATES: DriveTemplate[] = [
  {
    id: "sde",
    group: "Engineering",
    title: "Software Engineer (Backend)",
    jd: `We are hiring a Software Engineer (2–5 years) to build and operate backend services.
Responsibilities: design and implement REST APIs and background jobs; write well-tested, maintainable code; work with PostgreSQL and Redis; participate in code reviews and on-call; improve performance and reliability.
Requirements: strong programming skills in Java, Python, Go or Node.js; data structures and algorithms; SQL and data modelling; Git; testing practices; familiarity with Docker and cloud services (AWS/GCP).
Nice to have: messaging systems (Kafka/RabbitMQ), observability tooling, microservices experience.`,
  },
  {
    id: "frontend",
    group: "Engineering",
    title: "Frontend Engineer (React)",
    jd: `We are looking for a Frontend Engineer (2–5 years) to build fast, accessible web applications.
Responsibilities: develop features in React and TypeScript; collaborate with designers on UI and UX; manage application state and data fetching; write unit and end-to-end tests; optimise performance and accessibility (WCAG).
Requirements: JavaScript/TypeScript, React, HTML, CSS, REST/GraphQL integration, browser performance fundamentals, testing (Jest, Playwright/Cypress), Git.
Nice to have: Next.js, design systems, CI/CD, analytics instrumentation.`,
  },
  {
    id: "senior-backend",
    group: "Engineering",
    title: "Senior Backend Engineer",
    jd: `We are hiring a Senior Backend Engineer (5–8 years) to design and own critical services.
Responsibilities: lead the design of scalable distributed systems; own reliability, observability and performance; mentor engineers and lead design reviews; collaborate with product on technical strategy.
Requirements: deep experience with one of Java/Go/Node.js/Python; system design at scale; PostgreSQL and caching; event-driven architecture (Kafka); cloud (AWS/GCP), Docker, Kubernetes; testing and CI/CD.
Nice to have: payments or fintech domain experience; incident leadership.`,
  },
  {
    id: "data-analyst",
    group: "Data",
    title: "Data Analyst",
    jd: `We are hiring a Data Analyst (1–4 years) to turn data into decisions.
Responsibilities: write SQL to analyse product and business data; build dashboards in Tableau or Power BI; define and track KPIs; run A/B test analyses; present insights to stakeholders.
Requirements: strong SQL; Excel; Python (Pandas) for analysis; statistics fundamentals; data visualisation; clear communication.
Nice to have: dbt, Airflow, experience with product analytics tools.`,
  },
  {
    id: "devops",
    group: "Engineering",
    title: "DevOps / Site Reliability Engineer",
    jd: `We are hiring a DevOps / SRE engineer (3–6 years) to run reliable infrastructure.
Responsibilities: build and maintain CI/CD pipelines; manage cloud infrastructure with Terraform; operate Kubernetes clusters; set up monitoring, alerting and incident response; improve deployment safety and cost.
Requirements: Linux, networking fundamentals, AWS or GCP, Docker, Kubernetes, Terraform, scripting (Bash/Python), observability (Prometheus/Grafana).
Nice to have: security hardening, service mesh, on-call leadership.`,
  },
  {
    id: "em",
    group: "Engineering leadership",
    title: "Engineering Manager",
    jd: `We are hiring an Engineering Manager to lead a team of 6–10 engineers.
Responsibilities: hire, grow and retain a high-performing team; own delivery of the team's roadmap; partner with product and design on priorities; drive engineering quality, reliability and technical direction; manage performance and give regular feedback.
Requirements: 8+ years in software engineering including 2+ years managing engineers; strong system design and architecture judgement; experience with agile delivery, stakeholder management and hiring.
Nice to have: experience scaling teams, managing managers, budgeting.`,
  },
  {
    id: "sales",
    group: "Business",
    title: "Account Executive (B2B Sales)",
    jd: `We are hiring an Account Executive (3–6 years) to grow mid-market B2B revenue.
Responsibilities: run the full sales cycle from discovery to close; build pipeline with SDRs and marketing; negotiate pricing and contracts; maintain accurate CRM records (Salesforce); collaborate with customer success on expansion.
Requirements: proven quota attainment in B2B SaaS; consultative selling; negotiation; stakeholder management; excellent communication.
Nice to have: experience selling to technical buyers, familiarity with MEDDICC.`,
  },
  {
    id: "support",
    group: "Business",
    title: "Customer Support Specialist",
    jd: `We are hiring a Customer Support Specialist (1–3 years) to help customers succeed.
Responsibilities: resolve customer issues by email, chat and phone; troubleshoot product problems and escalate bugs with clear reproduction steps; maintain help-centre articles; track issues in the ticketing system; meet response-time targets.
Requirements: strong written and verbal communication; empathy; problem-solving; comfort with SaaS products; ticketing tools (Zendesk/Freshdesk).
Nice to have: basic SQL, experience with technical products.`,
  },
  {
    id: "hr-exec",
    group: "People",
    title: "HR Executive",
    jd: `We are hiring an HR Executive (2–4 years) to support the employee lifecycle.
Responsibilities: coordinate recruitment and onboarding; maintain HR records and HRMS data; support payroll inputs and compliance; run employee engagement initiatives; handle employee queries on policies and benefits.
Requirements: knowledge of HR operations and labour-law basics; recruitment coordination; payroll processes; Excel; strong interpersonal and communication skills; confidentiality.
Nice to have: experience with HRMS tools, campus hiring.`,
  },
];
