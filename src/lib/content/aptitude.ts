/**
 * Built-in aptitude question bank (screening tests). Organisations add their own questions on top. Each question has
 * four options and one correct answer (index into `options`), with a short worked explanation for staff.
 */

export type AptitudeSection = "quant" | "logical" | "verbal" | "technical";

export interface AptitudeQuestion {
  id: string;
  section: AptitudeSection;
  difficulty: "easy" | "medium" | "hard";
  stem: string;
  options: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  explanation: string;
}

export const SECTION_LABEL: Record<AptitudeSection, string> = {
  quant: "Quantitative aptitude",
  logical: "Logical reasoning",
  verbal: "Verbal ability",
  technical: "Technical fundamentals",
};

export const APTITUDE_BANK: AptitudeQuestion[] = [
  /* ------------------------------ Quantitative ------------------------------ */
  { id: "q-train-pole", section: "quant", difficulty: "easy", stem: "A train 150 m long passes a pole in 10 seconds. What is its speed in km/h?", options: ["45", "54", "60", "72"], answer: 1, explanation: "150 m / 10 s = 15 m/s; × 18/5 = 54 km/h." },
  { id: "q-percent-sum", section: "quant", difficulty: "easy", stem: "What is 20% of 250 plus 15% of 400?", options: ["100", "105", "110", "115"], answer: 2, explanation: "50 + 60 = 110." },
  { id: "q-simple-interest", section: "quant", difficulty: "easy", stem: "What is the simple interest on ₹8,000 at 5% per year for 3 years?", options: ["₹1,000", "₹1,200", "₹1,260", "₹1,500"], answer: 1, explanation: "8,000 × 5 × 3 / 100 = 1,200." },
  { id: "q-work-together", section: "quant", difficulty: "medium", stem: "A can finish a job in 12 days and B in 18 days. Working together, how many days do they take?", options: ["6", "7.2", "7.5", "8"], answer: 1, explanation: "1/12 + 1/18 = 5/36 per day, so 36/5 = 7.2 days." },
  { id: "q-average-removed", section: "quant", difficulty: "medium", stem: "The average of five numbers is 24. When one number is removed, the average of the other four is 22. Which number was removed?", options: ["28", "30", "32", "34"], answer: 2, explanation: "5 × 24 − 4 × 22 = 120 − 88 = 32." },
  { id: "q-ratio-class", section: "quant", difficulty: "easy", stem: "Boys and girls in a class of 40 are in the ratio 3 : 5. How many girls are there?", options: ["15", "20", "25", "30"], answer: 2, explanation: "40 × 5/8 = 25." },
  { id: "q-markup-discount", section: "quant", difficulty: "medium", stem: "A shop marks an item up by 25% over cost, then gives a 20% discount on the marked price. What is the result?", options: ["5% profit", "5% loss", "No profit, no loss", "2% profit"], answer: 2, explanation: "1.25 × 0.80 = 1.00 of the cost." },
  { id: "q-lcm", section: "quant", difficulty: "easy", stem: "What is the smallest number divisible by 6, 8 and 12?", options: ["24", "36", "48", "96"], answer: 0, explanation: "LCM(6, 8, 12) = 24." },
  { id: "q-average-speed", section: "quant", difficulty: "medium", stem: "A car travels 60 km at 30 km/h and the next 60 km at 60 km/h. What is its average speed for the whole trip?", options: ["40 km/h", "42 km/h", "45 km/h", "50 km/h"], answer: 0, explanation: "120 km in 2 h + 1 h = 3 h → 40 km/h." },
  { id: "q-dice-seven", section: "quant", difficulty: "medium", stem: "Two fair dice are thrown. What is the probability that the sum is 7?", options: ["1/6", "1/12", "5/36", "7/36"], answer: 0, explanation: "6 of 36 outcomes give 7 → 1/6." },
  { id: "q-percent-increase", section: "quant", difficulty: "easy", stem: "The price of an item rises from ₹40 to ₹50. What is the percentage increase?", options: ["20%", "25%", "10%", "30%"], answer: 1, explanation: "10 / 40 = 25%." },
  { id: "q-compound-interest", section: "quant", difficulty: "medium", stem: "What is the compound interest on ₹10,000 at 10% per year for 2 years, compounded annually?", options: ["₹2,000", "₹2,100", "₹2,110", "₹2,200"], answer: 1, explanation: "10,000 × 1.1² = 12,100 → interest 2,100." },

  /* ----------------------------- Logical reasoning ----------------------------- */
  { id: "l-series-pronic", section: "logical", difficulty: "easy", stem: "What comes next: 2, 6, 12, 20, 30, ?", options: ["40", "42", "44", "48"], answer: 1, explanation: "n(n + 1): 6 × 7 = 42." },
  { id: "l-series-powers", section: "logical", difficulty: "easy", stem: "What comes next: 3, 9, 27, 81, ?", options: ["162", "243", "324", "729"], answer: 1, explanation: "Each term × 3." },
  { id: "l-syllogism-chain", section: "logical", difficulty: "medium", stem: "All Bloops are Razzies and all Razzies are Lazzies. Which must be true?", options: ["All Lazzies are Bloops", "All Bloops are Lazzies", "Some Razzies are not Bloops", "No Bloops are Lazzies"], answer: 1, explanation: "The 'all' relation chains: Bloops ⊂ Razzies ⊂ Lazzies." },
  { id: "l-odd-one-out", section: "logical", difficulty: "easy", stem: "Which is the odd one out?", options: ["Apple", "Mango", "Carrot", "Banana"], answer: 2, explanation: "Carrot is a vegetable; the others are fruits." },
  { id: "l-letter-code", section: "logical", difficulty: "easy", stem: "If CAT is written as DBU, how is DOG written?", options: ["EPH", "FQI", "CNF", "EOH"], answer: 0, explanation: "Each letter moves one forward: D→E, O→P, G→H." },
  { id: "l-blood-relation", section: "logical", difficulty: "medium", stem: "Pointing to a man, Riya says: \"His mother is the only daughter of my mother.\" How is the man related to Riya?", options: ["Brother", "Son", "Nephew", "Father"], answer: 1, explanation: "The only daughter of Riya's mother is Riya, so Riya is his mother." },
  { id: "l-directions", section: "logical", difficulty: "easy", stem: "You face north, turn right, turn right again, then turn left. Which way are you facing?", options: ["North", "South", "East", "West"], answer: 2, explanation: "North → East → South → (left) East." },
  { id: "l-fibonacci", section: "logical", difficulty: "easy", stem: "What comes next: 1, 1, 2, 3, 5, 8, ?", options: ["11", "12", "13", "15"], answer: 2, explanation: "Each term is the sum of the two before: 5 + 8 = 13." },
  { id: "l-number-code", section: "logical", difficulty: "medium", stem: "In a code, 2 = 6, 3 = 12 and 4 = 20. What is 5?", options: ["25", "28", "30", "35"], answer: 2, explanation: "n(n + 1): 5 × 6 = 30." },
  { id: "l-queue-position", section: "logical", difficulty: "easy", stem: "In a queue, Ravi is 7th from the front and 12th from the back. How many people are in the queue?", options: ["17", "18", "19", "20"], answer: 1, explanation: "7 + 12 − 1 = 18." },
  { id: "l-syllogism-some", section: "logical", difficulty: "medium", stem: "Some cats are dogs. All dogs are birds. Which conclusion definitely follows?", options: ["Some cats are birds", "All birds are cats", "No cat is a bird", "All cats are dogs"], answer: 0, explanation: "The cats that are dogs are also birds." },
  { id: "l-clock-angle", section: "logical", difficulty: "hard", stem: "What is the angle between the hour and minute hands of a clock at 3:30?", options: ["60°", "75°", "82.5°", "90°"], answer: 1, explanation: "Hour hand at 105°, minute hand at 180° → 75°." },

  /* -------------------------------- Verbal -------------------------------- */
  { id: "v-syn-abundant", section: "verbal", difficulty: "easy", stem: "Choose the word closest in meaning to ABUNDANT.", options: ["Scarce", "Plentiful", "Rare", "Meagre"], answer: 1, explanation: "Abundant means existing in large quantities." },
  { id: "v-ant-transparent", section: "verbal", difficulty: "easy", stem: "Choose the word opposite in meaning to TRANSPARENT.", options: ["Clear", "Opaque", "Lucid", "Obvious"], answer: 1, explanation: "Opaque: not letting light through." },
  { id: "v-agreement-neither", section: "verbal", difficulty: "medium", stem: "Which sentence is grammatically correct?", options: ["Neither of the answers are correct.", "Neither of the answers is correct.", "Neither of the answer is correct.", "Neither the answers is correct."], answer: 1, explanation: "'Neither' takes a singular verb." },
  { id: "v-since", section: "verbal", difficulty: "easy", stem: "Fill in the blank: She has been working here ___ 2019.", options: ["for", "since", "from", "by"], answer: 1, explanation: "'Since' marks a point in time with the present perfect." },
  { id: "v-syn-meticulous", section: "verbal", difficulty: "easy", stem: "Choose the word closest in meaning to METICULOUS.", options: ["Careless", "Thorough", "Quick", "Lazy"], answer: 1, explanation: "Meticulous: showing great attention to detail." },
  { id: "v-polyglot", section: "verbal", difficulty: "easy", stem: "One word for 'a person who speaks many languages':", options: ["Polyglot", "Philanthropist", "Pedestrian", "Optimist"], answer: 0, explanation: "Poly (many) + glot (tongue)." },
  { id: "v-error-dont", section: "verbal", difficulty: "easy", stem: "Which part of the sentence has an error? \"He / don't / like / coffee.\"", options: ["He", "don't", "like", "coffee"], answer: 1, explanation: "Third person singular: 'doesn't'." },
  { id: "v-ant-expand", section: "verbal", difficulty: "easy", stem: "Choose the word opposite in meaning to EXPAND.", options: ["Enlarge", "Contract", "Extend", "Grow"], answer: 1, explanation: "Contract: become smaller." },
  { id: "v-idiom-ice", section: "verbal", difficulty: "medium", stem: "What does 'break the ice' mean?", options: ["Start a conversation and ease tension", "Break something by mistake", "End a friendship", "Cool something down"], answer: 0, explanation: "An idiom for easing awkwardness when people first meet." },
  { id: "v-subjunctive", section: "verbal", difficulty: "medium", stem: "Fill in the blank: If I ___ you, I would apologise.", options: ["was", "were", "am", "be"], answer: 1, explanation: "Hypothetical conditional uses 'were'." },
  { id: "v-spelling", section: "verbal", difficulty: "medium", stem: "Which spelling is correct?", options: ["Accomodate", "Acommodate", "Accommodate", "Acomodate"], answer: 2, explanation: "Double 'c' and double 'm'." },
  { id: "v-analogy-author", section: "verbal", difficulty: "easy", stem: "Book : Author :: Painting : ?", options: ["Canvas", "Painter", "Museum", "Brush"], answer: 1, explanation: "The creator of each." },

  /* -------------------------------- Technical -------------------------------- */
  { id: "t-binary-search", section: "technical", difficulty: "easy", stem: "What is the time complexity of binary search on a sorted array of n elements?", options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"], answer: 1, explanation: "The search space halves each step." },
  { id: "t-fifo", section: "technical", difficulty: "easy", stem: "Which data structure follows first-in, first-out (FIFO)?", options: ["Stack", "Queue", "Tree", "Graph"], answer: 1, explanation: "A queue removes the oldest element first." },
  { id: "t-sql-having", section: "technical", difficulty: "medium", stem: "Which SQL clause filters groups after aggregation?", options: ["WHERE", "HAVING", "ORDER BY", "LIMIT"], answer: 1, explanation: "WHERE filters rows before grouping; HAVING filters groups." },
  { id: "t-python-floordiv", section: "technical", difficulty: "easy", stem: "In Python 3, what does 7 // 2 evaluate to?", options: ["3.5", "3", "4", "3.0"], answer: 1, explanation: "Floor division of integers gives the integer 3." },
  { id: "t-http-404", section: "technical", difficulty: "easy", stem: "Which HTTP status code means 'Not Found'?", options: ["200", "301", "404", "500"], answer: 2, explanation: "404 Not Found." },
  { id: "t-primary-key", section: "technical", difficulty: "medium", stem: "Which is NOT a property of a primary key?", options: ["Values are unique", "Values cannot be null", "It identifies each row", "It can contain duplicate values"], answer: 3, explanation: "A primary key is unique and not null." },
  { id: "t-quicksort-worst", section: "technical", difficulty: "medium", stem: "What is the worst-case time complexity of quicksort?", options: ["O(n log n)", "O(n²)", "O(n)", "O(log n)"], answer: 1, explanation: "Consistently poor pivots give n levels of n work." },
  { id: "t-encapsulation", section: "technical", difficulty: "easy", stem: "Which OOP principle hides an object's internal state behind methods?", options: ["Inheritance", "Polymorphism", "Encapsulation", "Abstraction of classes"], answer: 2, explanation: "Encapsulation bundles data with the methods that guard it." },
  { id: "t-binary-ten", section: "technical", difficulty: "easy", stem: "What is the decimal number 10 in binary?", options: ["1001", "1010", "1100", "1110"], answer: 1, explanation: "8 + 2 = 1010₂." },
  { id: "t-parentheses", section: "technical", difficulty: "medium", stem: "Which data structure is most natural for checking that parentheses are balanced?", options: ["Queue", "Stack", "Hash table", "Heap"], answer: 1, explanation: "Push on '(' and pop on ')'." },
  { id: "t-git-branch", section: "technical", difficulty: "easy", stem: "Which git command creates a new branch and switches to it?", options: ["git branch -d name", "git checkout -b name", "git merge name", "git init name"], answer: 1, explanation: "checkout -b (or switch -c) creates and switches." },
  { id: "t-dns", section: "technical", difficulty: "easy", stem: "What does DNS do?", options: ["Encrypts web traffic", "Translates domain names into IP addresses", "Stores web pages", "Assigns MAC addresses"], answer: 1, explanation: "The Domain Name System resolves names to addresses." },
];
