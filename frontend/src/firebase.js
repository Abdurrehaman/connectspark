import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, RecaptchaVerifier, signInWithPhoneNumber, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCD1min9zHpXNvmNDMntPkXgDsBvJ4HNYc",
  authDomain: "connectspark-192e3.firebaseapp.com",
  projectId: "connectspark-192e3",
  storageBucket: "connectspark-192e3.firebasestorage.app",
  messagingSenderId: "553158223644",
  appId: "1:553158223644:web:7598df1879ea1215cc3cd9"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);

export { RecaptchaVerifier, signInWithPhoneNumber };
