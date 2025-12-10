// ---------------------------
// 0) إعداد Supabase
// ---------------------------
const SUPABASE_URL = "https://mqjpmefyntbmsmhwedef.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xanBtZWZ5bnRibXNtaHdlZGVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyODQ0NjUsImV4cCI6MjA4MDg2MDQ2NX0.4Y1S-B4BRku2Yin-6Bdm2CKpXgoN0BK5HO3UFj81hBA";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------
// العناصر
// ---------------------------
const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const captureBtn = document.getElementById("captureBtn");
const resultBox = document.getElementById("resultBox");
const loader = document.getElementById("loader");
const scanBox = document.querySelector(".scan-box");
const cameraContainer = document.querySelector(".card-camera");
const startCameraBtn = document.getElementById("startCameraBtn");
const switchCameraBtn = document.getElementById("switchCameraBtn");
const manualInput = document.getElementById("manualIdInput");
const manualAddBtn = document.getElementById("manualAddBtn");

let currentStream = null;
let currentFacingMode = "environment"; // "environment" = back camera, "user" = front camera

// Normalize Arabic-Indic and Eastern Arabic-Indic digits to ASCII and remove non-digits
function normalizeDigits(input) {
    if (!input) return "";
    let s = String(input);
    // Replace Eastern Arabic-Indic digits (Persian) U+06F0 - U+06F9
    s = s.replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06F0));
    // Replace Arabic-Indic digits U+0660 - U+0669
    s = s.replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660));
    // Remove all non-digit characters (spaces, punctuation, NBSP, ZWSP, etc.)
    s = s.replace(/[^\d]/g, "");
    return s;
}

// Convert Arabic digits in-place but keep other characters (useful for live input)
function convertArabicDigitsOnly(s) {
    if (!s) return "";
    return String(s)
        .replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
        .replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660));
}

// realtime manual input handling: convert Arabic digits, keep digits only, limit to 14
if (manualInput) {
    // start with button disabled until valid
    if (manualAddBtn) manualAddBtn.disabled = true;

    manualInput.addEventListener('input', (e) => {
        let v = manualInput.value || "";
        v = convertArabicDigitsOnly(v);
        // remove non-digits
        v = v.replace(/[^0-9]/g, '');
        if (v.length > 14) v = v.slice(0, 14);
        manualInput.value = v;

        const valid = /^[1-3]\d{13}$/.test(v);
        if (manualAddBtn) manualAddBtn.disabled = !valid;
        manualInput.classList.toggle('invalid', v.length > 0 && !valid);
        const manualError = document.getElementById("manualError");
        if (manualError) {
            manualError.style.display = (v.length > 0 && !valid) ? "block" : "none";
        }
        
    });
}

// ---------------------------
// 1) فتح الكاميرا عند الضغط على الزر
// ---------------------------
startCameraBtn.addEventListener("click", async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: currentFacingMode } 
        });
        currentStream = stream;
        video.srcObject = stream;

        cameraContainer.style.display = "block";
        startCameraBtn.style.display = "none";
        switchCameraBtn.style.display = "flex";
    } catch (err) {
        showError("❌ لم نتمكن من فتح الكاميرا: " + err.message);
    }
});

// Switch between front and back camera
if (switchCameraBtn) {
    switchCameraBtn.addEventListener("click", async () => {
        try {
            // Stop current stream
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }

            // Toggle facing mode
            currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";

            // Start new stream with switched camera
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: currentFacingMode } 
            });
            currentStream = stream;
            video.srcObject = stream;
        } catch (err) {
            showError("❌ لم نتمكن من تبديل الكاميرا: " + err.message);
        }
    });
}

// ---------------------------
// 2) التقاط الصورة + Crop المستطيل
// ---------------------------
captureBtn.addEventListener("click", async () => {
    resultBox.style.display = "none";
    loader.style.display = "block";

    try {
        const context = canvas.getContext("2d");

        // أبعاد الفيديو
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // أبعاد المستطيل بالنسبة للـ video
        const rect = scanBox.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();
        const scaleX = vw / videoRect.width;
        const scaleY = vh / videoRect.height;

        const cropX = (rect.left - videoRect.left) * scaleX;
        const cropY = (rect.top - videoRect.top) * scaleY;
        const cropW = rect.width * scaleX;
        const cropH = rect.height * scaleY;

        canvas.width = cropW;
        canvas.height = cropH;

        context.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const imageDataUrl = canvas.toDataURL("image/jpeg");

        // ---------------------------
        // Preprocess image to improve OCR (upscale, grayscale, threshold)
        // ---------------------------
        function preprocessCanvas(srcCanvas, scale = 2) {
            const w = srcCanvas.width;
            const h = srcCanvas.height;
            const tmp = document.createElement("canvas");
            tmp.width = Math.max(100, Math.round(w * scale));
            tmp.height = Math.max(100, Math.round(h * scale));
            const ctx = tmp.getContext("2d");
            ctx.drawImage(srcCanvas, 0, 0, tmp.width, tmp.height);

            try {
                const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);
                const data = imgData.data;
                // convert to grayscale
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }
                // compute average brightness and choose threshold
                let sum = 0;
                for (let i = 0; i < data.length; i += 4) sum += data[i];
                const avg = sum / (data.length / 4) || 128;
                // clamp threshold to reasonable bounds to avoid extremes
                const thresh = Math.max(90, Math.min(200, Math.round(avg)));
                // apply binary threshold
                for (let i = 0; i < data.length; i += 4) {
                    const v = data[i] < thresh ? 0 : 255;
                    data[i] = data[i + 1] = data[i + 2] = v;
                }
                ctx.putImageData(imgData, 0, 0);
            } catch (e) {
                // getImageData can throw on cross-origin canvases; fallback to scaled copy
                console.warn('preprocessCanvas: getImageData failed, using scaled copy', e);
            }

            return tmp.toDataURL("image/jpeg", 0.95);
        }

        // try multiple scales to improve OCR reliability
        const tesseractConfig = {
            tessedit_char_whitelist: "0123456789٠١٢٣٤٥٦٧٨٩",
            tessedit_pageseg_mode: "7",
            logger: m => console.log('TESSERACT:', m)
        };

        

        async function recognizeAtScales(scales = [2, 3, 4]) {
            let best = null;
            for (const s of scales) {
                const dataUrl = preprocessCanvas(canvas, s);
                try {
                    const { data: { text } } = await Tesseract.recognize(dataUrl, "ara+eng", tesseractConfig);
                    const digits = normalizeDigits(text);
                    console.log('OCR scale', s, '->', text, '=>', digits);

                    const m = digits.match(/([1-3]\d{13})/);
                    if (m && m[1]) return { id: m[1], text, digits, scale: s };

                    if (!best || (digits.length > (best.digits || "").length)) {
                        best = { id: null, text, digits, scale: s };
                    }
                } catch (e) {
                    console.warn('Tesseract failed at scale', s, e);
                }
            }
            return best;
        }

        const ocrResult = await recognizeAtScales([2, 3, 4]);

        if (!ocrResult) {
            showError("❌ فشل التعرف عبر OCR على الصورة");
            return;
        }

        console.log('OCR final result:', ocrResult);

        if (!ocrResult.id) {
            showError("❌ لم يتم العثور على رقم قومي مكون من 14 رقمًا. يمكنك إدخاله يدويًا.");
            return;
        }

        const id_number = ocrResult.id;

        // ---------------------------
        // 5) التحقق في Supabase
        // ---------------------------
        const { data: exists, error: queryError } = await supabase
            .from("national_ids")
            .select("id_number")
            .eq("id_number", id_number);

        if (queryError) {
            return showError("❌ خطأ في الاتصال بقاعدة البيانات: " + queryError.message);
        }

        if (exists.length > 0) {
            return showSuccess("⚠️ الرقم القومي موجود مسبقًا: " + id_number);
        }

        // ---------------------------
        // 6) إدخال الرقم الجديد
        // ---------------------------
        const { error: insertError } = await supabase
            .from("national_ids")
            .insert([{ id_number }]);

        if (insertError) {
            return showError("❌ فشل حفظ الرقم في قاعدة البيانات: " + insertError.message);
        }

        showSuccess("✅ تم حفظ الرقم القومي بنجاح: " + id_number);

    } catch (err) {
        showError("❌ خطأ غير متوقع: " + err.message);
    } finally {
        loader.style.display = "none";
    }
});

// ---------------------------
// إضافة يدوي للرقم القومي
// ---------------------------
if (manualAddBtn) {
    manualAddBtn.addEventListener("click", async () => {
        const raw = (manualInput && manualInput.value) ? manualInput.value.trim() : "";
        const cleaned = normalizeDigits(raw);

        if (!cleaned || cleaned.length !== 14 || !/^[1-3]\d{13}$/.test(cleaned)) {
            return showError("❌ الرجاء إدخال رقم قومي صالح مكون من 14 رقمًا ويبدأ بـ1-3");
        }

        loader.style.display = "block";
        manualAddBtn.disabled = true;

        try {
            const id_number = cleaned;

            const { data: exists, error: queryError } = await supabase
                .from("national_ids")
                .select("id_number")
                .eq("id_number", id_number);

            if (queryError) {
                return showError("❌ خطأ في الاتصال بقاعدة البيانات: " + queryError.message);
            }

            if (exists.length > 0) {
                return showSuccess("⚠️ الرقم القومي موجود مسبقًا: " + id_number);
            }

            const { error: insertError } = await supabase
                .from("national_ids")
                .insert([{ id_number }]);

            if (insertError) {
                return showError("❌ فشل حفظ الرقم في قاعدة البيانات: " + insertError.message);
            }

            if (manualInput) manualInput.value = "";
            showSuccess("✅ تم حفظ الرقم القومي بنجاح: " + id_number);
        } catch (e) {
            showError("❌ خطأ غير متوقع: " + e.message);
        } finally {
            loader.style.display = "none";
            manualAddBtn.disabled = false;
        }

    });
}

// ---------------------------
// دوال عرض الرسائل
// ---------------------------
function showError(msg) {
    loader.style.display = "none";
    resultBox.style.display = "block";
    resultBox.style.background = "#ffe5e5";
    resultBox.style.color = "#cc0000";
    resultBox.innerHTML = msg;
}

function showSuccess(msg) {
    loader.style.display = "none";
    resultBox.style.display = "block";
    resultBox.style.background = "#e5ffea";
    resultBox.style.color = "#008000";
    resultBox.innerHTML = msg;
}
