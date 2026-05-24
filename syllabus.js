// ── Comprehensive Indian Board + Exam Syllabus ───────────────────────
// Sources: NTA JEE Main, NMC NEET, CBSE Class 11-12 official syllabi

const SYLLABUS = {

  physics: {
    chapters: [
      // Class 11
      'Physics and Measurement (Units, Dimensions, Error Analysis)',
      'Kinematics (Motion in a Straight Line, Motion in a Plane, Projectile)',
      'Laws of Motion (Newton\'s Laws, Friction, Circular Motion)',
      'Work, Energy and Power (Work-Energy Theorem, Collisions, Power)',
      'System of Particles and Rotational Motion (Torque, Angular Momentum, MOI, Rolling)',
      'Gravitation (Kepler\'s Laws, Gravitational Potential Energy, Satellites, Escape Velocity)',
      'Mechanical Properties of Solids (Stress, Strain, Young\'s Modulus, Elasticity)',
      'Mechanical Properties of Fluids (Pressure, Bernoulli\'s Theorem, Viscosity, Surface Tension)',
      'Thermal Properties of Matter (Heat, Calorimetry, Thermal Expansion, Conduction, Convection)',
      'Thermodynamics (Laws of Thermodynamics, Isothermal, Adiabatic, Carnot Engine)',
      'Kinetic Theory of Gases (KTG, Mean Free Path, Degrees of Freedom, Equipartition)',
      'Oscillations (SHM, Spring-Mass System, Simple Pendulum, Energy in SHM)',
      'Waves (Wave Motion, Superposition, Standing Waves, Doppler Effect)',
      // Class 12
      'Electric Charges and Fields (Coulomb\'s Law, Electric Field, Gauss\'s Law)',
      'Electrostatic Potential and Capacitance (Potential, Capacitors, Dielectrics)',
      'Current Electricity (Ohm\'s Law, Kirchhoff\'s Laws, Wheatstone Bridge, EMF)',
      'Moving Charges and Magnetism (Biot-Savart Law, Ampere\'s Law, Cyclotron)',
      'Magnetism and Matter (Magnetic Dipole, Earth\'s Magnetism, Hysteresis)',
      'Electromagnetic Induction (Faraday\'s Law, Lenz\'s Law, Motional EMF, Inductance)',
      'Alternating Current (AC Circuits, RLC, Resonance, Power Factor, Transformers)',
      'Electromagnetic Waves (EM Spectrum, Displacement Current, Properties)',
      'Ray Optics (Reflection, Refraction, Lenses, Mirrors, Prism, Optical Instruments)',
      'Wave Optics (Huygens Principle, Interference, Diffraction, Polarisation)',
      'Dual Nature of Radiation and Matter (Photoelectric Effect, de Broglie, Davisson-Germer)',
      'Atoms (Rutherford Model, Bohr\'s Model, Spectral Series, Hydrogen Atom)',
      'Nuclei (Nuclear Binding Energy, Radioactivity, Fission, Fusion)',
      'Semiconductor Electronics (p-n Junction, Diodes, Transistors, Logic Gates)',
      'Communication Systems (Modulation, Bandwidth, Propagation) [CBSE]',
    ],
    highYieldJEE: ['Electrostatics', 'Optics', 'Mechanics', 'Electromagnetism', 'Modern Physics', 'Current Electricity', 'SHM & Waves'],
    highYieldNEET: ['Laws of Motion', 'Work Energy Power', 'Electrostatics', 'Current Electricity', 'Ray Optics', 'Atoms & Nuclei', 'Thermodynamics'],
  },

  chemistry: {
    chapters: [
      // Class 11 Physical
      'Some Basic Concepts of Chemistry (Mole Concept, Stoichiometry, Limiting Reagent)',
      'Atomic Structure (Bohr Model, Quantum Numbers, Orbitals, Electronic Configuration)',
      'Chemical Bonding and Molecular Structure (VSEPR, Hybridisation, MO Theory, Resonance)',
      'States of Matter: Gases and Liquids (Gas Laws, Kinetic Theory, Real Gases, Van der Waals)',
      'Chemical Thermodynamics (Enthalpy, Entropy, Gibbs Free Energy, Hess\'s Law)',
      'Equilibrium (Chemical Equilibrium, Le Chatelier\'s Principle, Ionic Equilibrium, pH, Buffers)',
      'Redox Reactions (Oxidation Number, Balancing by Ion-electron Method)',
      // Class 11 Inorganic
      'Classification of Elements and Periodicity in Properties (Periodic Trends)',
      'Hydrogen (Properties, Hydrides, Water, Hydrogen Peroxide)',
      's-Block Elements (Alkali and Alkaline Earth Metals)',
      'p-Block Elements Group 13 & 14 (Boron, Carbon Family)',
      'Environmental Chemistry (Air, Water, Soil Pollution)',
      'Some Basic Principles and Techniques of Organic Chemistry (IUPAC, Isomerism, Inductive Effect)',
      'Hydrocarbons (Alkanes, Alkenes, Alkynes, Aromatic Hydrocarbons)',
      // Class 12 Physical
      'Solutions (Henry\'s Law, Raoult\'s Law, Colligative Properties, Osmosis, van\'t Hoff)',
      'Electrochemistry (Galvanic Cells, EMF, Nernst Equation, Electrolysis, Kohlrausch)',
      'Chemical Kinetics (Rate Law, Order, Half-Life, Activation Energy, Arrhenius Equation)',
      'Surface Chemistry (Adsorption, Colloids, Emulsions, Catalysis)',
      // Class 12 Inorganic
      'General Principles and Processes of Isolation of Elements (Metallurgy)',
      'p-Block Elements Group 15 to 18 (Nitrogen, Oxygen, Halogen, Noble Gas Family)',
      'd and f Block Elements (Transition Metals, Lanthanides, Actinides)',
      'Coordination Compounds (Werner\'s Theory, IUPAC Nomenclature, Isomerism, VBT, CFT)',
      // Class 12 Organic
      'Haloalkanes and Haloarenes (SN1, SN2, Elimination Reactions)',
      'Alcohols, Phenols and Ethers (Properties, Reactions, Acidity)',
      'Aldehydes, Ketones and Carboxylic Acids (Nucleophilic Addition, Aldol, Reactions)',
      'Amines (Basicity, Reactions, Diazonium Salts)',
      'Biomolecules (Carbohydrates, Proteins, Enzymes, Vitamins, Nucleic Acids)',
      'Polymers (Addition, Condensation, Natural, Synthetic)',
      'Chemistry in Everyday Life (Drugs, Soaps, Detergents)',
    ],
    highYieldJEE: ['Chemical Bonding', 'Coordination Compounds', 'Aldehydes Ketones', 'p-Block Elements', 'Equilibrium', 'Electrochemistry', 'Chemical Kinetics'],
    highYieldNEET: ['Biomolecules', 'Chemical Bonding', 'Coordination Compounds', 'Organic Reactions', 'Equilibrium', 'Atomic Structure'],
  },

  mathematics: {
    chapters: [
      // Class 11
      'Sets, Relations and Functions (Types, Operations, Composition)',
      'Trigonometric Functions (Ratios, Identities, Equations, Inverse)',
      'Complex Numbers and Quadratic Equations (Argand Plane, Roots, Discriminant)',
      'Linear Inequalities (Graphical Solutions, Systems)',
      'Permutations and Combinations (Factorial, nPr, nCr, Applications)',
      'Binomial Theorem (General Term, Middle Term, Coefficients)',
      'Sequences and Series (AP, GP, HP, AGP, Special Sums)',
      'Straight Lines (Slope, Equations, Angle Between Lines, Distance)',
      'Conic Sections (Circle, Parabola, Ellipse, Hyperbola)',
      'Introduction to Three Dimensional Geometry (Distance, Section Formula)',
      'Limits and Derivatives (Limits, L\'Hopital, Basic Differentiation)',
      'Mathematical Reasoning (Statements, Connectives, Quantifiers)',
      'Statistics (Mean, Variance, Standard Deviation)',
      'Probability (Classical, Conditional, Bayes\'s Theorem)',
      // Class 12
      'Relations and Functions (Inverse, Composition, Types, Invertibility)',
      'Inverse Trigonometric Functions (Domain, Range, Properties)',
      'Matrices (Types, Operations, Transpose, Adjoint)',
      'Determinants (Properties, Cofactors, Inverse, Cramer\'s Rule)',
      'Continuity and Differentiability (Chain Rule, Implicit, Logarithmic, Parametric)',
      'Applications of Derivatives (Tangents, Normals, Maxima, Minima, Rate of Change)',
      'Integrals (Integration by Parts, Substitution, Partial Fractions, Definite Integrals)',
      'Applications of Integrals (Area Under Curves)',
      'Differential Equations (Order, Degree, Variable Separable, Linear DE)',
      'Vector Algebra (Dot Product, Cross Product, Scalar Triple Product)',
      'Three Dimensional Geometry (Lines, Planes, Angle, Distance)',
      'Linear Programming (Graphical Method, Corner Points, Feasible Region)',
      'Probability (Conditional, Bayes\'s Theorem, Random Variables, Binomial Distribution)',
    ],
    highYieldJEE: ['Calculus (Limits, Derivatives, Integrals)', 'Coordinate Geometry', 'Matrices and Determinants', 'Probability', 'Complex Numbers', '3D Geometry & Vectors', 'Sequences and Series'],
  },

  biology: {
    chapters: [
      // Class 11
      'The Living World (Taxonomy, Classification, Nomenclature)',
      'Biological Classification (5-Kingdom, Monera, Protista, Fungi)',
      'Plant Kingdom (Algae, Bryophyta, Pteridophyta, Gymnosperms, Angiosperms)',
      'Animal Kingdom (Non-Chordates, Chordates, Phyla Characteristics)',
      'Morphology of Flowering Plants (Root, Stem, Leaf, Flower, Fruit, Seed)',
      'Anatomy of Flowering Plants (Tissue Systems, Secondary Growth)',
      'Structural Organisation in Animals (Earthworm, Cockroach, Frog)',
      'Cell: The Unit of Life (Cell Theory, Prokaryotic, Eukaryotic, Organelles)',
      'Biomolecules (Carbohydrates, Proteins, Lipids, Nucleic Acids, Enzymes)',
      'Cell Cycle and Cell Division (Mitosis, Meiosis, Significance)',
      'Transport in Plants (Osmosis, Plasmolysis, Xylem Transport, Phloem)',
      'Mineral Nutrition (Macro/Micro Nutrients, Hydroponics, Nitrogen Fixation)',
      'Photosynthesis in Higher Plants (Light Reactions, Calvin Cycle, C4, CAM)',
      'Respiration in Plants (Glycolysis, Krebs Cycle, Oxidative Phosphorylation)',
      'Plant Growth and Development (Phases, Plant Hormones, Photoperiodism)',
      'Digestion and Absorption (GI Tract, Digestive Enzymes, Absorption)',
      'Breathing and Exchange of Gases (Respiratory System, Volumes, Disorders)',
      'Body Fluids and Circulation (Blood, Lymph, Heart, Cardiac Cycle, ECG)',
      'Excretory Products and their Elimination (Kidney Structure, Urine Formation, Dialysis)',
      'Locomotion and Movement (Muscle Contraction, Sliding Filament Theory, Joints)',
      'Neural Control and Coordination (Neuron, Synapse, CNS, PNS, Reflex)',
      'Chemical Coordination and Integration (Endocrine Glands, Hormones, Disorders)',
      // Class 12
      'Reproduction in Organisms (Asexual, Sexual Reproduction)',
      'Sexual Reproduction in Flowering Plants (Pollination, Fertilisation, Seed Development)',
      'Human Reproduction (Male/Female Reproductive System, Gametogenesis, Fertilisation)',
      'Reproductive Health (Contraception, IVF, STDs, MTP)',
      'Principles of Inheritance and Variation (Mendel\'s Laws, Chromosomal Theory)',
      'Molecular Basis of Inheritance (DNA Structure, Replication, Transcription, Translation, Regulation)',
      'Evolution (Origin of Life, Theories, Evidence, Human Evolution)',
      'Human Health and Disease (Immunity, Vaccines, Pathogens, Cancer, Drugs)',
      'Strategies for Enhancement in Food Production (Plant Breeding, Animal Husbandry)',
      'Microbes in Human Welfare (Sewage, Biogas, Antibiotics)',
      'Biotechnology: Principles and Processes (rDNA Technology, PCR, Gel Electrophoresis)',
      'Biotechnology and its Applications (GM Crops, Gene Therapy, Ethical Issues)',
      'Organisms and Populations (Adaptations, Population Growth, Interactions)',
      'Ecosystem (Energy Flow, Food Chains, Ecological Pyramids, Nutrient Cycling)',
      'Biodiversity and Conservation (Hotspots, IUCN, Protected Areas)',
      'Environmental Issues (Pollution, Global Warming, Ozone Depletion)',
    ],
    highYieldNEET: ['Human Physiology', 'Genetics & Molecular Biology', 'Cell Biology', 'Reproduction', 'Ecology', 'Plant Physiology', 'Evolution'],
  },

};

/**
 * Returns a formatted syllabus string for a given subject and exam type
 * to be injected directly into AI prompts.
 */
function getSyllabusContext(subject, examType) {
  const subj = subject.toLowerCase().replace('computer science', 'cs').replace('maths', 'mathematics');
  const data = SYLLABUS[subj];
  if (!data) return '';

  const exam = (examType || '').toUpperCase();
  let highYield = '';

  if (exam.includes('JEE') && data.highYieldJEE) {
    highYield = `\nHIGH-YIELD TOPICS FOR ${exam}: ${data.highYieldJEE.join(', ')}`;
  } else if (exam.includes('NEET') && data.highYieldNEET) {
    highYield = `\nHIGH-YIELD TOPICS FOR NEET: ${data.highYieldNEET.join(', ')}`;
  }

  // Strip parenthetical details to keep prompt compact (saves ~400 tokens)
  const chapterList = data.chapters
    .map((c, i) => `${i + 1}. ${c.replace(/\s*\(.*?\)/g, '').trim()}`)
    .join(', ');

  return `\nOFFICIAL ${exam || 'CBSE'} SYLLABUS — ${subject.toUpperCase()} chapters: ${chapterList}${highYield}\nCRITICAL: Questions MUST come only from these chapters.`;
}

function getSyllabusTopicsArray(subject) {
  const subj = subject.toLowerCase().replace('computer science', 'cs').replace('maths', 'mathematics');
  const data = SYLLABUS[subj];
  if (!data) return [];
  return data.chapters.map(c => c.replace(/\s*\(.*?\)/g, '').trim());
}

function getActiveChapterKeywords(subject, topicName) {
  if (!topicName) return '';
  const subj = subject.toLowerCase().replace('computer science', 'cs').replace('maths', 'mathematics');
  const data = SYLLABUS[subj];
  if (!data) return '';
  
  const match = data.chapters.find(c => c.toLowerCase().includes(topicName.toLowerCase()));
  if (!match) return '';
  
  const parenMatch = match.match(/\((.*?)\)/);
  return parenMatch ? parenMatch[1] : '';
}

module.exports = { getSyllabusContext, getSyllabusTopicsArray, getActiveChapterKeywords };
