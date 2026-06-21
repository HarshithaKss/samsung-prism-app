import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Dimensions,
  SafeAreaView,
  Animated,
  Easing,
  ActivityIndicator,
  Image,
  Pressable,
  Alert,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, Camera } from 'expo-camera';

// -------------------------------------------------------------
// FLASK API CONFIGURATIONS & NETWORK SETTINGS
// -------------------------------------------------------------
// Docker/Web: uses relative URL '' so requests go through nginx reverse proxy
// Mobile:     uses the local network IP of the machine running the Flask server
const MOBILE_API_URL = 'http://192.168.1.6:5000';  // ← Change this to your machine's local IP for mobile use
const API_BASE_URL = Platform.OS === 'web' ? '' : MOBILE_API_URL;
const USE_API = true;                            // Set to false to bypass the API and run offline mock mode
const API_TIMEOUT_MS = 10000;                    // Connection timeout boundary before falling back

// Tiny 1x1 black PNG image base64 data to act as payload for mock capture inputs
const DUMMY_BASE64_IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// -------------------------------------------------------------
// DESIGN TOKENS & STYLES (Samsung One UI Dark)
// -------------------------------------------------------------
const COLORS = {
  background: '#0A0A0A',      // Full screen dark background
  card: '#1A1A1A',            // Elevated card containers
  cardElevated: '#242424',    // Hover/Active status or highlights
  samsungBlue: '#1259C3',     // Brand color for buttons, border glows
  cyanAccent: '#00C4FF',      // Inference details, top score highlights
  border: '#2C2C2C',          // Subtle grey lines/borders
  textPrimary: '#FFFFFF',     // Main text
  textSecondary: '#A0A0A0',   // Subtitle, labels, and grey details
  textMuted: '#666666',       // Muted/placeholder text
  progressBg: '#2E2E2E',      // Inactive track of progress bars
};

const DOCUMENT_CLASSES = [
  { id: 1, name: 'Magazine Cover', defaultConfidence: 0.92 },
  { id: 2, name: 'Movie Poster', defaultConfidence: 0.85 },
  { id: 3, name: 'book', defaultConfidence: 0.81 },
  { id: 4, name: 'business_cards', defaultConfidence: 0.97 },
  { id: 5, name: 'direction_traffic_signs', defaultConfidence: 0.90 },
  { id: 6, name: 'government_ids', defaultConfidence: 0.99 },
  { id: 7, name: 'maps', defaultConfidence: 0.79 },
  { id: 8, name: 'menu', defaultConfidence: 0.88 },
  { id: 9, name: 'newspaper', defaultConfidence: 0.76 },
];

const MOCK_HISTORY = [
  {
    id: 'hist-1',
    className: 'government_ids',
    confidence: 0.99,
    inferenceTime: '92 ms',
    date: 'Today, 01:24 PM',
    iconName: 'card-sharp',
    color: '#00C4FF',
    predictions: [
      { name: 'government_ids', score: 0.99 },
      { name: 'business_cards', score: 0.01 },
      { name: 'book', score: 0.00 },
    ],
    allScores: [
      { name: 'government_ids', score: 0.99 },
      { name: 'business_cards', score: 0.01 },
      { name: 'book', score: 0.00 },
      { name: 'Magazine Cover', score: 0.00 },
      { name: 'Movie Poster', score: 0.00 },
      { name: 'direction_traffic_signs', score: 0.00 },
      { name: 'maps', score: 0.00 },
      { name: 'menu', score: 0.00 },
      { name: 'newspaper', score: 0.00 },
    ]
  },
  {
    id: 'hist-2',
    className: 'menu',
    confidence: 0.88,
    inferenceTime: '112 ms',
    date: 'Yesterday, 08:15 PM',
    iconName: 'restaurant-sharp',
    color: '#FFB300',
    predictions: [
      { name: 'menu', score: 0.88 },
      { name: 'Magazine Cover', score: 0.07 },
      { name: 'maps', score: 0.05 },
    ],
    allScores: [
      { name: 'menu', score: 0.88 },
      { name: 'Magazine Cover', score: 0.07 },
      { name: 'maps', score: 0.05 },
      { name: 'Movie Poster', score: 0.00 },
      { name: 'book', score: 0.00 },
      { name: 'business_cards', score: 0.00 },
      { name: 'direction_traffic_signs', score: 0.00 },
      { name: 'government_ids', score: 0.00 },
      { name: 'newspaper', score: 0.00 },
    ]
  }
];

const { width } = Dimensions.get('window');
const VIEWFINDER_SIZE = width - 40;

// Helper function to race fetch requests with timeouts
const fetchWithTimeout = async (url, options, timeout = API_TIMEOUT_MS) => {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Network request timeout')), timeout))
  ]);
};



export default function App() {
  // Lifted session scan log history state
  const [historyItems, setHistoryItems] = useState(MOCK_HISTORY);

  // Runtime camera permission hook
  const [permission, requestPermission] = useCameraPermissions();

  // Camera reference for captures
  const cameraRef = useRef(null);

  // Navigation & Screen routing state variables
  const [activeTab, setActiveTab] = useState('Camera'); // 'Camera' | 'History'
  const [selectedResult, setSelectedResult] = useState(null); // Result screen focus data record

  // Media & Loading states
  const [viewfinderImage, setViewfinderImage] = useState(null); // Selected gallery photo URI
  const [isInferring, setIsInferring] = useState(false);        // Loader overlay spinner
  const [showDeviceStats, setShowDeviceStats] = useState(false); // Stats bottom sheet toggle

  // Visual interface helpers
  const [flashOn, setFlashOn] = useState(false);
  const [cameraFront, setCameraFront] = useState(false);
  const [scoresExpanded, setScoresExpanded] = useState(false);

  // Animations
  const laserAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Request camera permission explicitly at startup
  useEffect(() => {
    (async () => {
      console.log('[*] Startup Camera permission request...');
      try {
        const { status } = await Camera.requestCameraPermissionsAsync();
        console.log('[+] Startup Camera permission status:', status);
      } catch (err) {
        console.error('[-] Error requesting camera permission at startup:', err);
      }
    })();
  }, []);

  // Viewfinder scanner visual animations
  useEffect(() => {
    if (activeTab === 'Camera' && !selectedResult) {
      const laserLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(laserAnim, {
            toValue: 1,
            duration: 3500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(laserAnim, {
            toValue: 0,
            duration: 3500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      laserLoop.start();

      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.95,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoop.start();

      return () => {
        laserLoop.stop();
        pulseLoop.stop();
      };
    }
  }, [activeTab, selectedResult]);

  const laserTranslateY = laserAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [12, VIEWFINDER_SIZE * 1.33 - 12],
  });


  // =============================================================
  // MODEL INFERENCE ROUTINE (Server call with Mock Fallback)
  // =============================================================
  // SWAP INSTRUCTIONS:
  // - Currently configured to execute classification on a remote Flask API server.
  // - The model (best.pt or exported ONNX/TFLite) must be located in the python 
  //   server codebase folder.
  // - If you wish to run inference directly on-device locally:
  //   1. Convert best.pt to TFLite (best.tflite) or ONNX (best.onnx).
  //   2. Upload the model file to `./assets/model/` inside this project.
  //   3. Install a local inference package (e.g. tensorflow-lite react-native).
  //   4. Rewrite this function's body to process target imageUri matrices locally.
  // =============================================================
  const runModelInference = async (imageUri = null, forcedClass = null, imageBase64 = null) => {
    setIsInferring(true);
    setScoresExpanded(false);

    let apiResponse = null;
    let startTimestamp = Date.now();
    const payloadBase64 = imageBase64 || DUMMY_BASE64_IMAGE;

    console.log(`\n=== INFERENCE ROUTINE START ===`);
    console.log(`[*] Configured API_BASE_URL: ${API_BASE_URL}`);
    console.log(`[*] Bypass switch (USE_API): ${USE_API}`);
    console.log(`[*] Connection timeout limit: ${API_TIMEOUT_MS}ms`);
    console.log(`[*] Input Image URI: ${imageUri ? imageUri : 'None (Using Default Payload)'}`);
    console.log(`[*] Base64 Length: ${payloadBase64.length} chars`);
    console.log(`[*] Base64 Prefix: ${payloadBase64.substring(0, 50)}...`);

    // A. Perform classification query to local Flask server if active
    if (USE_API) {
      try {
        console.log(`[*] Dispatching POST query to: ${API_BASE_URL}/classify ...`);
        const response = await fetchWithTimeout(`${API_BASE_URL}/classify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
             image: payloadBase64
          }),
        }, API_TIMEOUT_MS);

        console.log(`[+] Network transaction completed. HTTP Status: ${response.status}`);

        if (response.ok) {
          apiResponse = await response.json();
          console.log('[+] Flask API response parsing succeeded:', apiResponse);
          Alert.alert(
            'API Inference Success',
            `Server IP: ${API_BASE_URL}\nClassified: ${apiResponse.label}\nConfidence: ${(apiResponse.confidence * 100).toFixed(1)}%\nTime: ${apiResponse.inference_time_ms} ms`
          );
        } else {
          console.warn('[-] Flask API returned non-OK status code:', response.status);
          Alert.alert(
            'API Status Error',
            `Flask API returned HTTP Status: ${response.status}\n(Falling back to local mock model prediction)`
          );
        }
      } catch (err) {
        console.warn('[-] Flask API connection failed or timed out. Error:', err.message);
        Alert.alert(
          'API Connection Failed',
          `Target URL: ${API_BASE_URL}/classify\nError: ${err.message}\n(Wi-Fi subnet mismatch or firewall block?)\n(Falling back to local mock model prediction)`
        );
      }
    } else {
      console.log('[*] API bypass is active (USE_API=false). Directing to mock mode.');
      Alert.alert(
        'Offline Bypass Active',
        `USE_API is set to false.\n(Directing to local mock model prediction)`
      );
    }

    // B. Parse server API response
    if (apiResponse && apiResponse.label && apiResponse.confidence !== undefined) {
      const rawLabel = apiResponse.label;
      const rawConf = Number(apiResponse.confidence);
      const rawInferenceTime = apiResponse.inference_time_ms || (Date.now() - startTimestamp);
      const rawScores = apiResponse.all_scores; // expected array of 10 float values

      // Map values to local document classifications schema
      let scoresList = DOCUMENT_CLASSES.map((doc, idx) => {
        const value = (rawScores && rawScores[idx] !== undefined) ? Number(rawScores[idx]) : 0.0;
        return { name: doc.name, score: value };
      });

      // Confirm label matches prediction array
      const matchIdx = scoresList.findIndex(item => item.name.toLowerCase() === rawLabel.toLowerCase());
      if (matchIdx !== -1) {
        scoresList[matchIdx].score = rawConf;
      } else {
        // Fallback matching if labels are slightly offset
        const fuzzIdx = DOCUMENT_CLASSES.findIndex(d => d.name.toLowerCase().includes(rawLabel.toLowerCase()));
        if (fuzzIdx !== -1) {
          scoresList[fuzzIdx].name = rawLabel;
          scoresList[fuzzIdx].score = rawConf;
        } else {
          scoresList[0] = { name: rawLabel, score: rawConf };
        }
      }

      // Sort scores
      const sortedProbs = [...scoresList].sort((a, b) => b.score - a.score);

      const categoryIconMap = {
        'Magazine Cover': 'journal-sharp',
        'Movie Poster': 'film-sharp',
        'book': 'book-sharp',
        'business_cards': 'card-sharp',
        'direction_traffic_signs': 'compass-sharp',
        'government_ids': 'card-sharp',
        'maps': 'map-sharp',
        'menu': 'restaurant-sharp',
        'newspaper': 'newspaper-sharp'
      };

      const finalWinnerName = matchIdx !== -1 ? scoresList[matchIdx].name : rawLabel;

      // Read sub_class directly from server response (server calls HuggingFace)
      const subClassValue = apiResponse.sub_class || null;
      if (subClassValue) {
        Alert.alert('Direction Sign Detected: ' + subClassValue);
      }

      const outputResult = {
        id: `scan-${Date.now()}`,
        className: finalWinnerName,
        confidence: rawConf,
        inferenceTime: `${rawInferenceTime} ms`,
        date: 'Just now',
        iconName: categoryIconMap[finalWinnerName] || 'document-sharp',
        imageUri: imageUri,
        predictions: sortedProbs.slice(0, 3),
        allScores: sortedProbs,
        isRealAPI: true,
        subClass: subClassValue,
      };

      setHistoryItems((prev) => [outputResult, ...prev]);
      setSelectedResult(outputResult);
      setIsInferring(false);

    } else {
      // C. FALLBACK MOCK MODE
      const mockDelayMs = Math.floor(Math.random() * (300 - 50 + 1)) + 50;
      await new Promise((resolve) => setTimeout(resolve, mockDelayMs));

      let selectedClass;
      if (forcedClass) {
        selectedClass = forcedClass;
      } else {
        const randomIdx = Math.floor(Math.random() * DOCUMENT_CLASSES.length);
        selectedClass = DOCUMENT_CLASSES[randomIdx];
      }

      // Random winning confidence score C between 0.55 and 0.95
      const winnerConfidence = Number((Math.random() * (0.95 - 0.55) + 0.55).toFixed(4));
      const remainingWeight = Number((1.0 - winnerConfidence).toFixed(4));
      
      // Generate 8 random values for the remaining 8 classes
      const randomValues = Array.from({ length: 8 }, () => Math.random());
      const randomSum = randomValues.reduce((sum, v) => sum + v, 0);

      const rawProbs = randomValues.map((v) => (v / randomSum) * remainingWeight);
      const roundedProbs = rawProbs.map((p) => Number(p.toFixed(4)));
      const roundedSum = roundedProbs.reduce((sum, p) => sum + p, 0);

      const roundingDiff = Number((remainingWeight - roundedSum).toFixed(4));
      roundedProbs[roundedProbs.length - 1] = Number((roundedProbs[roundedProbs.length - 1] + roundingDiff).toFixed(4));

      const predictionsDistribution = DOCUMENT_CLASSES.map((doc) => {
        if (doc.name === selectedClass.name) {
          return { name: doc.name, score: winnerConfidence };
        }
        return null;
      });

      let probIndex = 0;
      DOCUMENT_CLASSES.forEach((doc, idx) => {
        if (doc.name !== selectedClass.name) {
          const val = Math.max(0, roundedProbs[probIndex++]);
          predictionsDistribution[idx] = { name: doc.name, score: val };
        }
      });

      const sortedPredictions = [...predictionsDistribution].sort((a, b) => b.score - a.score);

      const categoryIconMap = {
        'Magazine Cover': 'journal-sharp',
        'Movie Poster': 'film-sharp',
        'book': 'book-sharp',
        'business_cards': 'card-sharp',
        'direction_traffic_signs': 'compass-sharp',
        'government_ids': 'card-sharp',
        'maps': 'map-sharp',
        'menu': 'restaurant-sharp',
        'newspaper': 'newspaper-sharp'
      };

      // In mock/fallback mode there is no real image → sub_class not available
      const fallbackResult = {
        id: `scan-${Date.now()}`,
        className: selectedClass.name,
        confidence: winnerConfidence,
        inferenceTime: `${mockDelayMs} ms (Fallback)`,
        date: 'Just now',
        iconName: categoryIconMap[selectedClass.name] || 'document-sharp',
        imageUri: imageUri,
        predictions: sortedPredictions.slice(0, 3),
        allScores: sortedPredictions,
        isRealAPI: false,
        subClass: null,
      };

      setHistoryItems((prev) => [fallbackResult, ...prev]);
      setSelectedResult(fallbackResult);
      setIsInferring(false);
    }
  };

  const handleShutterPress = async () => {
    if (cameraRef.current) {
      try {
        console.log('[*] Shutter pressed, capturing photo...');
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.85,
          base64: true,
        });
        console.log('[+] Photo captured successfully. URI:', photo.uri, 'Base64 length:', photo.base64?.length);
        setViewfinderImage(photo.uri);
        await runModelInference(photo.uri, null, photo.base64);
      } catch (err) {
        console.error('[-] Camera capture failed:', err);
        Alert.alert(
          'Camera Capture Error',
          `Failed to take picture: ${err.message || String(err)}\n(Falling back to local mock model)`
        );
        await runModelInference();
      }
    } else {
      console.log('[!] Camera ref not available, running fallback mock inference.');
      Alert.alert(
        'Camera Reference Missing',
        `cameraRef.current is not initialized.\n(Falling back to local mock model)`
      );
      await runModelInference();
    }
  };

  // Image Picker query
  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      alert('Permission to access photos is required to select images!');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      base64: true,
    });

    if (!pickerResult.canceled && pickerResult.assets && pickerResult.assets.length > 0) {
      const uri = pickerResult.assets[0].uri;
      const base64Data = pickerResult.assets[0].base64;
      setViewfinderImage(uri);
      await runModelInference(uri, null, base64Data);
    }
  };

  const closeResultView = () => {
    setViewfinderImage(null);
    setSelectedResult(null);
  };

  const handleTabChange = (tab) => {
    setViewfinderImage(null);
    setSelectedResult(null);
    setActiveTab(tab);
  };

  // Screen 1: Camera
  const renderCameraScreen = () => {
    return (
      <View style={styles.screenContainer}>
        {/* Top App Bar */}
        <View style={styles.topAppBar}>
          <TouchableOpacity 
            style={styles.iconButton} 
            onPress={() => setFlashOn(!flashOn)}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={flashOn ? 'flash' : 'flash-off-outline'} 
              size={22} 
              color={flashOn ? '#FFEB3B' : COLORS.textSecondary} 
            />
          </TouchableOpacity>

          <View style={styles.pillLabelContainer}>
            <Text style={styles.pillLabelText}>PRISM · Doc Classifier</Text>
          </View>

          <TouchableOpacity 
            style={styles.iconButton}
            onPress={() => setCameraFront(!cameraFront)}
            activeOpacity={0.7}
          >
            <Ionicons 
              name="camera-reverse-outline" 
              size={22} 
              color={COLORS.textSecondary} 
            />
          </TouchableOpacity>
        </View>

        {/* Viewfinder Area */}
        <View style={styles.viewfinderWrapper}>
          <View style={styles.viewfinder}>
            {!permission ? (
              <View style={styles.cameraCanvas}>
                <ActivityIndicator size="small" color={COLORS.samsungBlue} />
              </View>
            ) : !permission.granted ? (
              <View style={styles.cameraCanvas}>
                <Ionicons name="camera-outline" size={44} color={COLORS.textSecondary} style={{ marginBottom: 14 }} />
                <Text style={[styles.permissionInstruction, { paddingHorizontal: 30, marginBottom: 18 }]}>
                  Camera permission is required to scan documents.
                </Text>
                <TouchableOpacity 
                  style={styles.permissionBtn} 
                  onPress={requestPermission}
                  activeOpacity={0.8}
                >
                  <Text style={styles.permissionBtnText}>Grant Permission</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <CameraView
                ref={cameraRef}
                style={styles.cameraView}
                facing={cameraFront ? 'front' : 'back'}
              >
                <View style={styles.cameraCanvas}>
                  {/* Image Preview inside viewfinder */}
                  {viewfinderImage && (
                    <Image source={{ uri: viewfinderImage }} style={styles.viewfinderImage} />
                  )}

                  {/* Corner Focus Brackets */}
                  <Animated.View style={[styles.cornerBracket, styles.bracketTopLeft, { transform: [{ scale: pulseAnim }] }]} />
                  <Animated.View style={[styles.cornerBracket, styles.bracketTopRight, { transform: [{ scale: pulseAnim }] }]} />
                  <Animated.View style={[styles.cornerBracket, styles.bracketBottomLeft, { transform: [{ scale: pulseAnim }] }]} />
                  <Animated.View style={[styles.cornerBracket, styles.bracketBottomRight, { transform: [{ scale: pulseAnim }] }]} />

                  {/* Grid Lines */}
                  <View style={styles.gridLinesContainer}>
                    <View style={styles.gridRow} />
                    <View style={styles.gridRow} />
                    <View style={styles.gridColContainer}>
                      <View style={styles.gridCol} />
                      <View style={styles.gridCol} />
                    </View>
                  </View>

                  {!viewfinderImage && (
                    <View style={styles.viewfinderTextContainer}>
                      <Ionicons name="scan-outline" size={32} color="rgba(255, 255, 255, 0.4)" />
                      <Text style={styles.viewfinderInstruction}>Align document within frame</Text>
                    </View>
                  )}

                  {/* Laser line animation */}
                  <Animated.View
                    style={[
                      styles.laserLine,
                      { transform: [{ translateY: laserTranslateY }] },
                    ]}
                  />
                </View>
              </CameraView>
            )}
          </View>
        </View>

        {/* Horizontal scrollable Chips list */}
        <View style={styles.chipsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScrollContent}
          >
            {DOCUMENT_CLASSES.map((docClass) => (
              <TouchableOpacity
                key={docClass.id}
                style={styles.chip}
                onPress={() => runModelInference(null, docClass)}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>{`${docClass.id}. ${docClass.name}`}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Bottom Shutter row */}
        <View style={styles.shutterRow}>
          {/* Gallery Button */}
          <TouchableOpacity 
            style={styles.galleryButton} 
            activeOpacity={0.7}
            onPress={pickImage}
          >
            <Ionicons name="images-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Shutter */}
          <TouchableOpacity
            style={styles.shutterOuter}
            onPress={handleShutterPress}
            activeOpacity={0.8}
          >
            <View style={styles.shutterInner} />
          </TouchableOpacity>

          <View style={styles.galleryButtonPlaceholder} />
        </View>
      </View>
    );
  };

  // Screen 2: Result
  const renderResultScreen = () => {
    if (!selectedResult) return null;

    const mainPrediction = selectedResult.predictions[0];
    const confidencePercent = (selectedResult.confidence * 100).toFixed(1);

    return (
      <View style={styles.screenContainer}>
        {/* Top App Bar */}
        <View style={styles.topAppBar}>
          <TouchableOpacity 
            style={styles.iconButton} 
            onPress={closeResultView}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <Text style={styles.resultsTitle}>Classification Result</Text>

          <TouchableOpacity 
            style={styles.iconButton} 
            onPress={() => setShowDeviceStats(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="information-circle-outline" size={22} color={COLORS.cyanAccent} />
          </TouchableOpacity>
        </View>

        <ScrollView 
          style={styles.resultsScroll} 
          contentContainerStyle={styles.resultsScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Tall Rounded Image Placeholder */}
          <View style={styles.tallImagePlaceholder}>
            {selectedResult.imageUri ? (
              <Image source={{ uri: selectedResult.imageUri }} style={styles.resultImage} />
            ) : (
              <View style={styles.mockDocumentLayout}>
                <Ionicons name={selectedResult.iconName} size={48} color={COLORS.samsungBlue} style={styles.docIconMock} />
                <View style={styles.docLineMockShort} />
                <View style={styles.docLineMockLong} />
                <View style={styles.docLineMockLong} />
                <View style={styles.docLineMockShort} />
                
                <View style={styles.scannedDetailsOverlay}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.cyanAccent} />
                  <Text style={styles.scannedDetailsText}>Captured Document · Saved to Session</Text>
                </View>
              </View>
            )}
          </View>

          {/* Primary Class Card */}
          <View style={styles.primaryClassCard}>
            <Text style={styles.classifiedSubtitle}>CLASSIFIED AS</Text>
            <Text style={styles.classNameHeader}>{selectedResult.className}</Text>
            {selectedResult.subClass && (
              <Text style={{ fontSize: 15, color: COLORS.cyanAccent, marginTop: -2, marginBottom: 8, fontWeight: '600' }}>
                Direction Sign: {selectedResult.subClass}
              </Text>
            )}

            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>Confidence</Text>
              <Text style={styles.confidenceValueText}>{confidencePercent}%</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${confidencePercent}%`, backgroundColor: COLORS.samsungBlue }]} />
            </View>

            {/* Inference Badge */}
            <View style={styles.inferenceBadge}>
              <Ionicons name="speedometer-outline" size={14} color={COLORS.cyanAccent} />
              <Text style={styles.inferenceBadgeText}>{selectedResult.inferenceTime}</Text>
            </View>
          </View>

          {/* Top 3 Predictions */}
          <View style={styles.predictionsCard}>
            <Text style={styles.cardHeaderTitle}>TOP 3 PREDICTIONS</Text>
            
            {selectedResult.predictions.map((pred, index) => {
              const scorePercent = (pred.score * 100).toFixed(0);
              return (
                <View key={`pred-${index}`} style={styles.predRow}>
                  <View style={styles.predMeta}>
                    <Text style={styles.predNameText}>{pred.name}</Text>
                    <Text style={styles.predScoreText}>{scorePercent}%</Text>
                  </View>
                  <View style={styles.progressBarTrackMini}>
                    <View 
                      style={[
                        styles.progressBarFillMini, 
                        { 
                          width: `${scorePercent}%`, 
                          backgroundColor: index === 0 ? COLORS.cyanAccent : '#444444' 
                        }
                      ]} 
                    />
                  </View>
                </View>
              );
            })}
          </View>

          {/* All 9 scores collapsible accordion */}
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setScoresExpanded(!scoresExpanded)}
            activeOpacity={0.7}
          >
            <Text style={styles.accordionHeaderTitle}>ALL 9 CLASS SCORES</Text>
            <Ionicons 
              name={scoresExpanded ? 'chevron-up' : 'chevron-down'} 
              size={20} 
              color={COLORS.textSecondary} 
            />
          </TouchableOpacity>

          {scoresExpanded && (
            <View style={styles.accordionContent}>
              {selectedResult.allScores.map((scoreObj, index) => {
                const scoreVal = (scoreObj.score * 100).toFixed(0);
                return (
                  <View key={`score-${index}`} style={styles.scoreRowItem}>
                    <Text style={styles.scoreItemIndex}>{index + 1}.</Text>
                    <View style={styles.scoreItemDetails}>
                      <View style={styles.scoreItemRow}>
                        <Text style={styles.scoreItemName}>{scoreObj.name}</Text>
                        <Text style={styles.scoreItemPercent}>{scoreVal}%</Text>
                      </View>
                      <View style={styles.progressBarTrackMicro}>
                        <View style={[styles.progressBarFillMicro, { width: `${scoreVal}%`, backgroundColor: scoreObj.score > 0 ? COLORS.samsungBlue : '#262626' }]} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Classify Another Button */}
          <TouchableOpacity 
            style={styles.classifyAnotherBtn} 
            onPress={closeResultView}
            activeOpacity={0.8}
          >
            <Text style={styles.classifyAnotherBtnText}>Classify Another</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  };

  // Screen 3: History
  const renderHistoryScreen = () => {
    return (
      <View style={styles.screenContainer}>
        {/* ONE UI Large Header */}
        <View style={styles.largeHeaderContainer}>
          <Text style={styles.largeHeaderSubtitle}>Document Scanner</Text>
          <Text style={styles.largeHeaderTitle}>Session History</Text>
        </View>

        {historyItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="file-tray-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No document sessions recorded yet.</Text>
          </View>
        ) : (
          <FlatList
            data={historyItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.historyListContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const mainConf = (item.confidence * 100).toFixed(0);
              return (
                <TouchableOpacity
                  style={styles.historyCard}
                  onPress={() => setSelectedResult(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.historyThumbnail}>
                    {item.imageUri ? (
                      <Image source={{ uri: item.imageUri }} style={styles.historyThumbnailImage} />
                    ) : (
                      <Ionicons name={item.iconName} size={24} color={COLORS.samsungBlue} />
                    )}
                  </View>

                  <View style={styles.historyInfo}>
                    <View style={styles.historyCardTop}>
                      <Text style={styles.historyClassName} numberOfLines={1}>
                        {item.className}
                      </Text>
                      <Text style={styles.historyConfidence}>{mainConf}%</Text>
                    </View>
                    
                    <Text style={styles.historyDate}>{item.date}</Text>
                    
                    <Text style={styles.historyInference}>{item.inferenceTime}</Text>
                  </View>
                  
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={styles.chevronIndicator} />
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    );
  };

  const renderMainContent = () => {
    if (selectedResult) {
      return renderResultScreen();
    }
    return activeTab === 'Camera' ? renderCameraScreen() : renderHistoryScreen();
  };

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar style="light" backgroundColor="#0A0A0A" />

      {/* Main Content */}
      <View style={styles.mainContent}>
        {renderMainContent()}
      </View>

      {/* Inference Spinner Dimmed Overlay */}
      {isInferring && (
        <View style={styles.scanningOverlay}>
          <View style={styles.scanningBox}>
            <ActivityIndicator size="large" color={COLORS.samsungBlue} />
            <Text style={styles.scanningOverlayText}>Running inference…</Text>
            <Text style={styles.scanningOverlaySubtext}>Samsung PRISM Doc Classifier</Text>
          </View>
        </View>
      )}

      {/* Device Stats Bottom Sheet */}
      {showDeviceStats && (
        <View style={styles.bottomSheetBackdrop}>
          <Pressable style={styles.bottomSheetDismissArea} onPress={() => setShowDeviceStats(false)} />
          <View style={styles.bottomSheetContainer}>
            <View style={styles.bottomSheetPill} />
            <Text style={styles.bottomSheetTitle}>Device Inference Stats</Text>
            
            <View style={styles.bottomSheetContent}>
              <View style={styles.bottomSheetRow}>
                <Text style={styles.bottomSheetLabel}>Inference Device</Text>
                <Text style={styles.bottomSheetValue}>CPU</Text>
              </View>

              <View style={styles.bottomSheetRow}>
                <Text style={styles.bottomSheetLabel}>Model</Text>
                <Text style={styles.bottomSheetValue}>
                  {selectedResult?.isRealAPI 
                    ? 'YOLOv8 Doc Classifier (Flask API)' 
                    : 'MobileNetV3 · 4.2MB quantized'}
                </Text>
              </View>

              <View style={styles.bottomSheetRow}>
                <Text style={styles.bottomSheetLabel}>Inference Time</Text>
                <Text style={[styles.bottomSheetValue, { color: COLORS.cyanAccent }]}>{selectedResult?.inferenceTime}</Text>
              </View>

              <View style={styles.bottomSheetRow}>
                <Text style={styles.bottomSheetLabel}>Battery Impact</Text>
                <View style={styles.batteryBadge}>
                  <Ionicons name="battery-charging" size={14} color="#00E676" />
                  <Text style={styles.batteryBadgeText}>Low</Text>
                </View>
              </View>

              <View style={styles.ramSection}>
                <View style={styles.ramHeader}>
                  <Text style={styles.bottomSheetLabel}>RAM Usage</Text>
                  <Text style={styles.ramValue}>142 MB / 8.0 GB</Text>
                </View>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${(142 / 8000) * 100}%`, backgroundColor: COLORS.samsungBlue }]} />
                </View>
              </View>

              <TouchableOpacity 
                style={styles.bottomSheetCloseBtn} 
                onPress={() => setShowDeviceStats(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.bottomSheetCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Bottom Tab Bar */}
      {!selectedResult && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => handleTabChange('Camera')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={activeTab === 'Camera' ? 'camera' : 'camera-outline'}
              size={22}
              color={activeTab === 'Camera' ? COLORS.samsungBlue : COLORS.textSecondary}
            />
            <Text
              style={[
                styles.tabText,
                { color: activeTab === 'Camera' ? COLORS.samsungBlue : COLORS.textSecondary }
              ]}
            >
              Camera
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => handleTabChange('History')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={activeTab === 'History' ? 'time' : 'time-outline'}
              size={22}
              color={activeTab === 'History' ? COLORS.samsungBlue : COLORS.textSecondary}
            />
            <Text
              style={[
                styles.tabText,
                { color: activeTab === 'History' ? COLORS.samsungBlue : COLORS.textSecondary }
              ]}
            >
              History
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// -------------------------------------------------------------
// STYLING SHEET
// -------------------------------------------------------------
const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
  },
  cameraView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  mainContent: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // -------------------------
  // TOP APP BAR STYLES
  // -------------------------
  topAppBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#161616',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabelContainer: {
    backgroundColor: '#1E1E1E',
    borderColor: COLORS.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
  },
  pillLabelText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // -------------------------
  // CAMERA SCREEN STYLES
  // -------------------------
  viewfinderWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginVertical: 10,
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE * 1.33, // 4:3 Aspect Ratio
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#222222',
    overflow: 'hidden',
    backgroundColor: '#121212',
  },
  cameraCanvas: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  viewfinderImage: {
    ...StyleSheet.absoluteFillObject,
    resizeMode: 'cover',
  },
  cornerBracket: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: COLORS.samsungBlue,
    zIndex: 2,
  },
  bracketTopLeft: {
    top: 20,
    left: 20,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 10,
  },
  bracketTopRight: {
    top: 20,
    right: 20,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 10,
  },
  bracketBottomLeft: {
    bottom: 20,
    left: 20,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 10,
  },
  bracketBottomRight: {
    bottom: 20,
    right: 20,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 10,
  },
  gridLinesContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-evenly',
    opacity: 0.15,
    zIndex: 1,
  },
  gridRow: {
    height: 1,
    backgroundColor: '#FFFFFF',
  },
  gridColContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  gridCol: {
    width: 1,
    backgroundColor: '#FFFFFF',
  },
  viewfinderTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
    zIndex: 2,
  },
  viewfinderInstruction: {
    color: '#CCCCCC',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    fontWeight: '500',
  },
  laserLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 2.5,
    backgroundColor: COLORS.cyanAccent,
    shadowColor: COLORS.cyanAccent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    zIndex: 3,
  },

  // Horizontal chips
  chipsContainer: {
    height: 52,
    justifyContent: 'center',
    marginVertical: 4,
  },
  chipsScrollContent: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  chip: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
  },
  chipText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },

  // Bottom shutter row
  shutterRow: {
    height: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
    marginBottom: 10,
  },
  galleryButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryButtonPlaceholder: {
    width: 50,
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: COLORS.samsungBlue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.samsungBlue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 8,
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
  },

  // -------------------------
  // RESULTS SCREEN STYLES
  // -------------------------
  resultsTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  resultsScroll: {
    flex: 1,
  },
  resultsScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 30,
  },
  tallImagePlaceholder: {
    height: 240,
    backgroundColor: COLORS.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  mockDocumentLayout: {
    flex: 1,
    width: '80%',
    padding: 24,
    marginVertical: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#151515',
    position: 'relative',
    justifyContent: 'center',
  },
  docIconMock: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  docLineMockShort: {
    height: 6,
    backgroundColor: '#2C2C2C',
    borderRadius: 3,
    width: '40%',
    marginVertical: 4,
    alignSelf: 'center',
  },
  docLineMockLong: {
    height: 6,
    backgroundColor: '#2C2C2C',
    borderRadius: 3,
    width: '75%',
    marginVertical: 4,
    alignSelf: 'center',
  },
  scannedDetailsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0A0A',
    borderRadius: 6,
    paddingVertical: 4,
    borderColor: '#222',
    borderWidth: 1,
  },
  scannedDetailsText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 5,
  },

  // Primary prediction card
  primaryClassCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    borderColor: COLORS.border,
    borderWidth: 1,
    marginBottom: 12,
  },
  classifiedSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  classNameHeader: {
    color: COLORS.textPrimary,
    fontSize: 28,
    fontWeight: 'bold',
    marginVertical: 6,
  },
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 6,
  },
  confidenceLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  confidenceValueText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  progressBarTrack: {
    height: 10,
    backgroundColor: COLORS.progressBg,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  inferenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 196, 255, 0.08)',
    borderColor: 'rgba(0, 196, 255, 0.2)',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  inferenceBadgeText: {
    color: COLORS.cyanAccent,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },

  // Top 3 predictions card
  predictionsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    borderColor: COLORS.border,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHeaderTitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  predRow: {
    marginBottom: 14,
  },
  predMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  predNameText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  predScoreText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  progressBarTrackMini: {
    height: 6,
    backgroundColor: COLORS.progressBg,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFillMini: {
    height: '100%',
    borderRadius: 3,
  },

  // Accordion lists
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderColor: COLORS.border,
    borderWidth: 1,
    marginBottom: 12,
  },
  accordionHeaderTitle: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  accordionContent: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderColor: COLORS.border,
    borderWidth: 1,
    marginBottom: 12,
  },
  scoreRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  scoreItemIndex: {
    color: COLORS.textMuted,
    width: 24,
    fontSize: 13,
    fontWeight: '500',
  },
  scoreItemDetails: {
    flex: 1,
  },
  scoreItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  scoreItemName: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '500',
  },
  scoreItemPercent: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  progressBarTrackMicro: {
    height: 4,
    backgroundColor: COLORS.progressBg,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFillMicro: {
    height: '100%',
    borderRadius: 2,
  },

  // Bottom action buttons
  classifyAnotherBtn: {
    height: 54,
    backgroundColor: COLORS.samsungBlue,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    shadowColor: COLORS.samsungBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  classifyAnotherBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },

  // -------------------------
  // HISTORY SCREEN STYLES
  // -------------------------
  largeHeaderContainer: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  largeHeaderSubtitle: {
    color: COLORS.samsungBlue,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  largeHeaderTitle: {
    color: COLORS.textPrimary,
    fontSize: 32,
    fontWeight: 'bold',
  },
  historyListContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  historyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 14,
    borderColor: COLORS.border,
    borderWidth: 1,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#202020',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#303030',
    overflow: 'hidden',
  },
  historyThumbnailImage: {
    width: 48,
    height: 48,
    resizeMode: 'cover',
  },
  historyInfo: {
    flex: 1,
    marginLeft: 14,
  },
  historyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginRight: 6,
  },
  historyClassName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: 'bold',
    maxWidth: '80%',
  },
  historyConfidence: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyDate: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  historyInference: {
    color: COLORS.cyanAccent,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  chevronIndicator: {
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },

  // -------------------------
  // LOADING OVERLAY STYLES
  // -------------------------
  scanningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 5, 5, 0.9)',
    zIndex: 3000,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanningBox: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    width: '80%',
  },
  scanningOverlayText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 16,
  },
  scanningOverlaySubtext: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },

  // -------------------------
  // BOTTOM TAB BAR STYLES
  // -------------------------
  tabBar: {
    height: 72,
    flexDirection: 'row',
    backgroundColor: '#0D0D0D',
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
    paddingBottom: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },

  // -------------------------
  // BOTTOM STATS SHEET STYLES
  // -------------------------
  bottomSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 2000,
    justifyContent: 'flex-end',
  },
  bottomSheetDismissArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 380, // covers screen above sheet height
  },
  bottomSheetContainer: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 34,
    paddingTop: 14,
    borderWidth: 1,
    borderColor: '#222222',
    borderBottomWidth: 0,
  },
  bottomSheetPill: {
    width: 40,
    height: 4,
    backgroundColor: '#444444',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  bottomSheetTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  bottomSheetContent: {
    marginTop: 6,
  },
  bottomSheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  bottomSheetLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  bottomSheetValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  batteryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.15)',
  },
  batteryBadgeText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  ramSection: {
    marginTop: 18,
    marginBottom: 10,
  },
  ramHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ramValue: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  bottomSheetCloseBtn: {
    height: 52,
    backgroundColor: '#262626',
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  bottomSheetCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  permissionInstruction: {
    color: '#CCCCCC',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 18,
  },
  permissionBtn: {
    backgroundColor: COLORS.samsungBlue,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: COLORS.samsungBlue,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
