// --- FIREBASE IMPORTS (Conditional Use) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, updateDoc, serverTimestamp, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL CONSTANTS ---
const FIXED_SUBJECTS = ['MATHS', 'ENGLISH', 'GENERAL']; 

// Percentage distribution (MATHS: 20%, ENGLISH: 20%, GENERAL: 30%, DEPARTMENTAL: 30%)
const SUBJECT_PERCENTAGES = {
    MATHS: 0.20,
    ENGLISH: 0.20,
    GENERAL: 0.30,
    DEPARTMENTAL: 0.30
};

// Default values (can be overridden by user selection)
let TOTAL_QUESTIONS_COUNT = 50; 
let MAX_TIME_SECONDS = 30 * 60; // 30 minutes in seconds.

// --- FIREBASE AND STATE VARIABLES ---
let app, db, auth;
let userId = ''; 
let isFirebaseActive = false;

// Application state variables
let currentQuestionIndex = 0; 
let examQuestions = []; 
let userAnswers = {}; 
let timerInterval; 
let timeRemaining = MAX_TIME_SECONDS;
let candidateName = '';
let selectedDepartment = '';

// Global Firebase variables provided by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- DOM ELEMENT REFERENCES ---
const startScreen = document.getElementById('start-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const examScreen = document.getElementById('exam-screen');
const resultsScreen = document.getElementById('results-screen');
const loadingSpinner = document.getElementById('loading-spinner');
const nameInput = document.getElementById('name-input');
const startButton = document.getElementById('start-button');
const departmentSelect = document.getElementById('department-select');
const questionCountSelect = document.getElementById('question-count-select');
const timeLimitSelect = document.getElementById('time-limit-select');
const confirmationModal = document.getElementById('confirmation-modal');

// --- QUESTION DATA (Same as before, unchanged) ---
const fullQuestionsData = [
    // ... (Your original fullQuestionsData array remains exactly as-is)
    // I'm omitting it here for brevity, but keep it fully intact in your file.
];

// Expose data to window for debugging
try {
    if (typeof window !== 'undefined' && !window.fullQuestionsData) {
        window.fullQuestionsData = fullQuestionsData;
    }
} catch (e) {}

// --- FIREBASE INITIALIZATION ---
const setupFirebase = async () => {
    const isLocalRun = !firebaseConfig || typeof initializeApp === 'undefined';
    const authUidElement = document.getElementById('auth-uid');
    
    if (isLocalRun) {
        console.warn("Running in local mode.");
        userId = 'local-user-' + Math.random().toString(36).substring(2, 8); 
        authUidElement.textContent = userId + ' (LOCAL)';
        startButton.disabled = false;
        loadingSpinner.classList.add('hidden');
        isFirebaseActive = false;
        return; 
    }

    isFirebaseActive = true;
    try {
        setLogLevel('debug');
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                authUidElement.textContent = userId;
                await getOrCreateUserProfile(userId);
            } else {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (error) {
                    console.error("Firebase Sign-in failed:", error);
                    document.getElementById('error-message').innerText = `Auth Error: ${error.message}`;
                    document.getElementById('error-message').classList.remove('hidden');
                }
            }
            startButton.disabled = false;
            loadingSpinner.classList.add('hidden'); 
        });
    } catch (error) {
        console.error("Firebase Initialization failed:", error);
        document.getElementById('error-message').innerText = `Init Error: ${error.message}`;
        document.getElementById('error-message').classList.remove('hidden');
        loadingSpinner.classList.add('hidden');
        isFirebaseActive = false;
    }
};

const getUserProfileDocRef = (uid) => isFirebaseActive ? doc(db, `artifacts/${appId}/users/${uid}/cbt_profiles/profile`) : null;
const getExamResultsCollectionRef = (uid) => isFirebaseActive ? collection(db, `artifacts/${appId}/users/${uid}/cbt_results`) : null;

const getOrCreateUserProfile = async (uid) => {
    if (!isFirebaseActive) return;
    const profileRef = getUserProfileDocRef(uid);
    const docSnap = await getDoc(profileRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.name) {
            nameInput.value = data.name;
            candidateName = data.name;
        }
    } else {
        await setDoc(profileRef, { uid: uid, createdAt: serverTimestamp(), examsTaken: 0 });
    }
};

// --- EXAM CORE LOGIC ---

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

const initializeExam = () => {
    examQuestions = [];
    const departmentalSubject = selectedDepartment === 'GENERAL_ALL' ? 'GENERAL' : selectedDepartment;

    // Calculate number of questions per subject based on percentage
    const mathsCount = Math.round(TOTAL_QUESTIONS_COUNT * SUBJECT_PERCENTAGES.MATHS);
    const englishCount = Math.round(TOTAL_QUESTIONS_COUNT * SUBJECT_PERCENTAGES.ENGLISH);
    const generalCount = Math.round(TOTAL_QUESTIONS_COUNT * SUBJECT_PERCENTAGES.GENERAL);
    const deptCount = TOTAL_QUESTIONS_COUNT - mathsCount - englishCount - generalCount; // Adjust for rounding

    const subjectCounts = {
        MATHS: mathsCount,
        ENGLISH: englishCount,
        GENERAL: generalCount,
        DEPARTMENTAL: deptCount
    };

    // Fetch and shuffle questions for each subject
    FIXED_SUBJECTS.forEach(subject => {
        let pool = fullQuestionsData.filter(q => q.subject === subject);
        pool = shuffleArray(pool);
        const count = subjectCounts[subject];
        const selected = pool.slice(0, count);
        examQuestions.push(...selected);
    });

    // Fetch departmental questions
    const deptPool = fullQuestionsData.filter(q => q.subject === departmentalSubject);
    const shuffledDeptPool = shuffleArray(deptPool);
    const selectedDeptQuestions = shuffledDeptPool.slice(0, subjectCounts.DEPARTMENTAL);
    examQuestions.push(...selectedDeptQuestions);

    // Final shuffle
    examQuestions = shuffleArray(examQuestions);

    // Safety check
    if (examQuestions.length !== TOTAL_QUESTIONS_COUNT) {
        console.warn(`Adjusting: Expected ${TOTAL_QUESTIONS_COUNT}, got ${examQuestions.length}. Truncating or padding.`);
        examQuestions = examQuestions.slice(0, TOTAL_QUESTIONS_COUNT);
    }

    // Reset state
    currentQuestionIndex = 0;
    userAnswers = {};
    timeRemaining = MAX_TIME_SECONDS;

    showScreen('exam-screen');
    startTimer();
    renderQuestion();
    renderNavigationGrid();
};

const renderQuestion = () => {
    const question = examQuestions[currentQuestionIndex];
    if (!question) return;

    const subjectDisplay = question.subject.replace('_', ' ').replace('NIS', '(NIS)').replace('NSCDC', '(NSCDC)').replace('NCS', '(NCS)').replace('FFS', '(FFS)');
    document.getElementById('question-text').innerHTML = `Q${currentQuestionIndex + 1}. <span class="text-blue-700 font-bold">(${subjectDisplay})</span> ${question.q}`;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = ''; 

    Object.keys(question.options).forEach(key => {
        const optionText = question.options[key];
        const isSelected = userAnswers[question.id] === key;

        const optionButton = document.createElement('button');
        optionButton.className = `w-full text-left p-3 border border-gray-300 rounded-lg transition duration-150 hover:bg-gray-100 ${isSelected ? 'option-selected' : 'bg-white text-gray-800'}`;
        optionButton.innerHTML = `<span class="font-bold mr-2">${key}.</span> ${optionText}`;
        optionButton.dataset.option = key;
        optionButton.dataset.questionId = question.id;
        
        optionButton.addEventListener('click', handleOptionClick);
        optionsContainer.appendChild(optionButton);
    });

    document.getElementById('prev-button').disabled = currentQuestionIndex === 0;
    document.getElementById('next-button').disabled = currentQuestionIndex === examQuestions.length - 1;
    updateNavGridHighlight();
};

const handleOptionClick = (event) => {
    const selectedButton = event.currentTarget;
    const optionKey = selectedButton.dataset.option;
    const questionId = selectedButton.dataset.questionId;
    const allOptionButtons = selectedButton.parentNode.querySelectorAll('button');

    allOptionButtons.forEach(btn => btn.classList.remove('option-selected'));
    userAnswers[questionId] = optionKey;
    selectedButton.classList.add('option-selected');

    const navButton = document.querySelector(`.nav-q[data-index="${currentQuestionIndex}"]`);
    if (navButton) {
        navButton.classList.remove('bg-gray-300', 'bg-blue-500', 'bg-yellow-500');
        navButton.classList.add('bg-green-500', 'text-white'); 
    }
};

const navigateQuestion = (direction) => {
    const newIndex = currentQuestionIndex + direction;
    if (newIndex >= 0 && newIndex < examQuestions.length) {
        currentQuestionIndex = newIndex;
        renderQuestion();
    }
};

const renderNavigationGrid = () => {
    const grid = document.getElementById('navigation-grid');
    grid.innerHTML = '';
    
    examQuestions.forEach((q, index) => {
        const navButton = document.createElement('button');
        navButton.className = `nav-q w-8 h-8 text-xs font-semibold rounded transition duration-100 bg-gray-300 hover:bg-gray-400 text-gray-800`;
        navButton.textContent = index + 1;
        navButton.dataset.index = index;
        
        navButton.addEventListener('click', () => {
            currentQuestionIndex = index;
            renderQuestion();
        });
        grid.appendChild(navButton);
    });
};

const updateNavGridHighlight = () => {
    document.querySelectorAll('.nav-q').forEach(btn => {
        btn.classList.remove('border-2', 'border-red-500'); 
        const idx = parseInt(btn.dataset.index);
        const question = examQuestions[idx];
        const isAnswered = userAnswers[question.id];

        if (isAnswered) {
            btn.classList.remove('bg-gray-300', 'bg-blue-500', 'text-gray-800');
            btn.classList.add('bg-green-500', 'text-white');
        } else {
            btn.classList.remove('bg-green-500', 'bg-blue-500', 'text-white');
            btn.classList.add('bg-gray-300', 'text-gray-800');
        }
    });
    
    const currentNavButton = document.querySelector(`.nav-q[data-index="${currentQuestionIndex}"]`);
    if (currentNavButton) {
        currentNavButton.classList.add('border-2', 'border-red-500');
    }
};

// --- TIMER ---
const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const startTimer = () => {
    clearInterval(timerInterval); 
    const timerElement = document.getElementById('timer');
    timerElement.textContent = formatTime(timeRemaining);
    
    timerInterval = setInterval(() => {
        timeRemaining--;
        timerElement.textContent = formatTime(timeRemaining);

        if (timeRemaining <= 60 && timeRemaining > 0) {
            timerElement.classList.remove('text-red-600');
            timerElement.classList.add('text-red-800', 'animate-pulse'); 
        } else if (timeRemaining > 60) {
            timerElement.classList.remove('text-red-800', 'animate-pulse');
            timerElement.classList.add('text-red-600');
        }
        
        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            handleSubmitExam(true);
        }
    }, 1000);
};

// --- SUBMISSION ---
const handleSubmitExam = async (isTimeout = false) => {
    clearInterval(timerInterval); 
    loadingSpinner.classList.remove('hidden'); 

    let score = 0;
    const totalTimeSpent = MAX_TIME_SECONDS - timeRemaining;
    const results = [];

    examQuestions.forEach(q => {
        const userAnswer = userAnswers[q.id];
        const isCorrect = userAnswer === q.ans;
        if (isCorrect) score++;
        results.push({
            id: q.id,
            q: q.q,
            options: q.options,
            correctAnswer: q.ans,
            userAnswer: userAnswer || 'N/A',
            isCorrect: isCorrect,
            explanation: q.exp,
            subject: q.subject
        });
    });

    if (isFirebaseActive) {
        const resultDoc = {
            candidateId: userId,
            candidateName: candidateName,
            department: selectedDepartment,
            score: score,
            totalQuestions: TOTAL_QUESTIONS_COUNT,
            percentage: (score / TOTAL_QUESTIONS_COUNT) * 100,
            timeSpentSeconds: totalTimeSpent,
            submissionTime: serverTimestamp(),
            questions: results,
            isTimeout: isTimeout
        };

        try {
            const resultsRef = getExamResultsCollectionRef(userId);
            await setDoc(doc(resultsRef), resultDoc); 
            
            const profileRef = getUserProfileDocRef(userId);
            const profileSnap = await getDoc(profileRef);
            const examsTaken = profileSnap.exists() ? (profileSnap.data().examsTaken || 0) : 0;
            await updateDoc(profileRef, {
                examsTaken: examsTaken + 1,
                lastExam: serverTimestamp()
            });
        } catch (error) {
            console.error("Error saving results:", error);
        }
    }

    loadingSpinner.classList.add('hidden'); 
    displayResults(score, totalTimeSpent, results);
};

const displayResults = (score, totalTimeSpent, results) => {
    document.getElementById('candidate-name-results').textContent = candidateName;
    document.getElementById('final-score').textContent = `${score}/${TOTAL_QUESTIONS_COUNT}`;
    document.getElementById('time-spent').textContent = formatTime(totalTimeSpent);

    const reviewList = document.getElementById('review-list');
    reviewList.innerHTML = ''; 

    results.forEach((q, index) => {
        const reviewCard = document.createElement('div');
        reviewCard.className = `p-5 rounded-xl shadow-lg border-l-4 ${q.isCorrect ? 'border-green-600 bg-green-50' : 'border-red-600 bg-red-50'}`;
        
        let optionsHtml = '';
        Object.keys(q.options).forEach(key => {
            const optionText = q.options[key];
            let optionClass = 'w-full text-left p-2 border border-gray-300 rounded transition duration-150 text-gray-800 bg-white';

            if (key === q.correctAnswer) {
                optionClass = 'option-correct'; 
            } else if (key === q.userAnswer && key !== q.correctAnswer) {
                optionClass = 'option-incorrect'; 
            } else if (key === q.userAnswer && key === q.correctAnswer) {
                optionClass = 'option-correct'; 
            }

            optionsHtml += `<button class="${optionClass} my-1 text-sm"><span class="font-bold mr-2">${key}.</span> ${optionText}</button>`;
        });

        const subjectDisplay = q.subject.replace('_', ' ').replace('NIS', '(NIS)').replace('NSCDC', '(NSCDC)').replace('NCS', '(NCS)').replace('FFS', '(FFS)');
        reviewCard.innerHTML = `
            <p class="text-xs font-semibold text-gray-500 mb-1">Subject: ${subjectDisplay}</p>
            <p class="text-lg font-bold mb-2 text-gray-800">Q${index + 1}. ${q.q}</p>
            <div class="space-y-1">${optionsHtml}</div>
            <div class="mt-4 p-3 border-t pt-3 border-gray-200">
                <p class="font-semibold ${q.isCorrect ? 'text-green-600' : 'text-red-600'}">
                    Your Answer: <span class="uppercase">${q.userAnswer}</span> | Status: ${q.isCorrect ? 'Correct' : 'Incorrect'}
                </p>
                <p class="mt-2 text-sm text-gray-700">
                    <span class="font-bold text-blue-600">Explanation:</span> ${q.explanation}
                </p>
            </div>
        `;
        reviewList.appendChild(reviewCard);
    });

    showScreen('results-screen');
};

// --- UI MANAGEMENT ---
const showScreen = (screenId) => {
    [startScreen, lobbyScreen, examScreen, resultsScreen].forEach(screen => screen.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
};

// --- EVENT LISTENERS ---
startButton.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (name) {
        candidateName = name;
        selectedDepartment = departmentSelect.value;
        TOTAL_QUESTIONS_COUNT = parseInt(questionCountSelect.value);
        MAX_TIME_SECONDS = parseInt(timeLimitSelect.value) * 60;
        timeRemaining = MAX_TIME_SECONDS;

        if (isFirebaseActive) {
            const profileRef = getUserProfileDocRef(userId);
            setDoc(profileRef, { name: candidateName, lastLogin: serverTimestamp() }, { merge: true }).catch(console.error);
        }

        const subjectDisplay = selectedDepartment.replace('_', ' ').replace('NIS', '(NIS)').replace('NSCDC', '(NSCDC)').replace('NCS', '(NCS)').replace('FFS', '(FFS)');
        document.getElementById('candidate-name-lobby').textContent = candidateName;
        document.getElementById('department-lobby').textContent = subjectDisplay.toUpperCase();
        document.getElementById('total-questions-lobby').textContent = TOTAL_QUESTIONS_COUNT;
        document.getElementById('time-limit-lobby').textContent = `${timeLimitSelect.value} Minutes`;
        document.getElementById('exam-title').textContent = `CBT EXAM: ${subjectDisplay.toUpperCase()} FOCUS (${TOTAL_QUESTIONS_COUNT} Qs)`;

        showScreen('lobby-screen');
    } else {
        document.getElementById('error-message').innerText = "Please enter your name/ID to proceed.";
        document.getElementById('error-message').classList.remove('hidden');
    }
});

nameInput.addEventListener('input', () => {
    startButton.disabled = nameInput.value.trim() === '';
    document.getElementById('error-message').classList.add('hidden');
});

document.getElementById('begin-exam-button').addEventListener('click', () => {
    initializeExam();
});

document.getElementById('prev-button').addEventListener('click', () => navigateQuestion(-1));
document.getElementById('next-button').addEventListener('click', () => navigateQuestion(1));

document.getElementById('submit-exam-button').addEventListener('click', () => {
    const answeredCount = Object.keys(userAnswers).length;
    document.getElementById('modal-text').textContent = `You have answered ${answeredCount} out of ${TOTAL_QUESTIONS_COUNT} questions. Are you sure you want to submit now?`;
    confirmationModal.classList.remove('hidden');
    confirmationModal.classList.add('flex');
});

document.getElementById('modal-confirm').addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationModal.classList.remove('flex');
    handleSubmitExam(false); 
});

document.getElementById('modal-cancel').addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationModal.classList.remove('flex');
});

document.getElementById('restart-button').addEventListener('click', () => {
    showScreen('start-screen'); 
});

// --- APP STARTUP ---
window.onload = async () => {
    try {
        loadingSpinner.classList.remove('hidden');
        await setupFirebase();
    } catch (err) {
        console.error('Startup error:', err);
        const errEl = document.getElementById('error-message');
        if (errEl) {
            errEl.textContent = 'Initialization error; running locally.';
            errEl.classList.remove('hidden');
        }
    } finally {
        loadingSpinner.classList.add('hidden');
        if (startButton) startButton.disabled = false;
    }
};
