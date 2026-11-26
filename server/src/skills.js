const groups = {
  Languages: 'JavaScript|JS|ECMAScript, TypeScript, Python, Java, C++, C#, C, Go|Golang, Rust, Kotlin, Swift, Ruby, PHP, Scala, Dart, R, MATLAB, Bash, PowerShell, SQL, HTML|HTML5, CSS|CSS3, Solidity, Perl, Lua, Elixir, Clojure, Groovy, Julia, Objective-C, Assembly',
  Frameworks: 'Node.js|NodeJS|Node JS, Express|Express.js|ExpressJS, React|React.js|ReactJS, React Native, Next.js|NextJS, Vue|Vue.js|VueJS, Nuxt, Angular, Svelte, Redux, Django, Flask, FastAPI, Spring Boot, Spring Framework, ASP.NET, .NET, Laravel, Ruby on Rails|Rails, NestJS, Koa, Remix, Astro, Tailwind CSS|Tailwind, Bootstrap, jQuery, Socket.IO, Electron, Flutter, Android, iOS, Jetpack Compose, SwiftUI',
  Databases: 'MongoDB|Mongo, PostgreSQL|Postgres, MySQL, SQLite, Redis, MariaDB, DynamoDB, Firebase, Firestore, Cassandra, Elasticsearch, OpenSearch, SQL Server|MSSQL, Oracle Database, Neo4j, Snowflake, BigQuery, Supabase, ClickHouse, Prisma, Mongoose, Sequelize, Drizzle, Hibernate, TypeORM, Entity Framework',
  'Cloud and DevOps': 'AWS|Amazon Web Services, Azure|Microsoft Azure, GCP|Google Cloud, Docker, Kubernetes|K8s, Terraform, Ansible, Jenkins, GitHub Actions, GitLab CI, Argo CD, Helm, Linux, Nginx, Apache, Prometheus, Grafana, Datadog, OpenTelemetry, Sentry, Cloudflare, Vercel, Netlify, Amazon S3|S3, EC2, Lambda, CloudFormation, IAM, CloudWatch, ECS, EKS, AWS RDS|Amazon RDS, CI/CD|CICD, DevOps',
  'Data and AI': 'Machine learning|ML, Deep learning, Natural language processing|NLP, Computer vision, Pandas, NumPy, SciPy, scikit-learn|sklearn, TensorFlow, PyTorch, Keras, OpenCV, Apache Spark|PySpark|Spark, Kafka, Airflow, dbt, Hadoop, Tableau, Power BI, Looker, Excel, ETL, Data engineering, Data analysis, Data modeling, Data visualization, Hugging Face, LangChain, LlamaIndex, Large language models|LLM|LLMs, Retrieval-augmented generation|RAG, Gemini, OpenAI, Ollama, MLflow, Jupyter, XGBoost, Statistics, A/B testing',
  'Tools and Practices': 'Git, GitHub, GitLab, Bitbucket, REST|RESTful, GraphQL, gRPC, SOAP, OpenAPI|Swagger, WebSockets, Microservices, System design, Agile, Scrum, Jira, Confluence, Figma, Postman, Jest, Vitest, Playwright, Cypress, Selenium, JUnit, Pytest, Mocha, Testing Library, Unit testing, Integration testing, Accessibility|WCAG, OAuth|OAuth2, OpenID Connect|OIDC, JWT, API design, RabbitMQ, SQS, Redis Streams, Vite, Webpack, Rollup, Babel, npm, pnpm, Yarn, WebRTC, Web performance, Responsive design, Technical writing, Project management, Product management, UX research, Stakeholder management',
  'Business and Operations': 'Customer service, Sales, Lead generation, Salesforce, HubSpot, SEO, SEM, Google Analytics, Google Ads, Social media marketing, Email marketing, Content strategy, Financial modeling, Budgeting, Accounting, Bookkeeping, Auditing, Risk management, Financial analysis, QuickBooks, SAP, Workday, Recruiting, Talent acquisition, HRIS, Supply chain, Logistics, Procurement, Inventory management, Operations management, Quality assurance, Six Sigma, Lean, Negotiation, Market research, Copywriting, Adobe Photoshop|Photoshop, Adobe Illustrator|Illustrator, Adobe InDesign|InDesign'
};

const escapeRegex = (value) => value.replace(/[.*+?^$(){}[\]|\\]/g, '\\$&');
const aliases = new Map();
const matches = [];

for (const [category, terms] of Object.entries(groups)) {
  for (const term of terms.split(', ')) {
    const names = term.split('|');
    const entry = { name: names[0], category };
    for (const alias of names) {
      aliases.set(alias.toLowerCase(), entry);
      // Single-letter languages are meaningful in a skill list, but poor prose matches.
      if (alias.length === 1) continue;
      const suffix = alias === 'React' ? '(?!\\s+Native)' : '';
      matches.push({
        entry,
        pattern: new RegExp('(?<![\\p{L}\\p{N}+#.])' + escapeRegex(alias) + suffix + '(?![\\p{L}\\p{N}+#])', 'iu')
      });
    }
  }
}

export function skillIdentity(name) {
  const normalized = name.trim().replace(/\s+/g, ' ');
  return aliases.get(normalized.toLowerCase()) || { name: normalized, category: 'Other' };
}

export function skillKey(name) {
  return skillIdentity(name).name.toLowerCase();
}

export function redactContact(text) {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
    .replace(/(?<![\w\d])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d(?:[ .-]?\d){8,11}(?![\w\d])/g, '[phone removed]')
    .replace(/^\s*(?:home |mailing )?address\s*:[^\n]+/gim, '[address removed]')
    .replace(/\b\d{1,6}\s+(?:[A-Za-z][\w.'-]*\s+){1,6}(?:street|st\.|avenue|ave\.|road|rd\.|lane|ln\.|drive|dr\.|boulevard|blvd\.|court|ct\.)\b[^\n]*/gi, '[address removed]');
}

export function findSkills(text) {
  const lines = redactContact(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const skills = new Map();
  for (const { entry, pattern } of matches) {
    if (skills.has(entry.name)) continue;
    const line = lines.find((candidate) => pattern.test(candidate));
    if (line) {
      const index = line.search(pattern);
      const start = Math.max(0, index - 65);
      skills.set(entry.name, { ...entry, evidence: line.slice(start, start + 240) });
    }
  }
  for (const line of lines) {
    const languageList = /^(?:(?:technical )?skills|languages|programming languages)\s*:\s*(.*)$/i.exec(line)?.[1];
    for (const candidate of (languageList || '').split(/[,;|]/)) {
      const skill = aliases.get(candidate.trim().toLowerCase());
      if (skill && !skills.has(skill.name)) skills.set(skill.name, { ...skill, evidence: line.slice(0, 240) });
    }
  }
  return [...skills.values()];
}
