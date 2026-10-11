import {createContext,useContext,useEffect,useState,useRef,type ReactNode} from 'react';
import {onAuthStateChanged,browserLocalPersistence,setPersistence,type User} from 'firebase/auth';
import {getDoc,onSnapshot} from 'firebase/firestore';
import {auth} from './cloud';
import {userRef,type UserProfile} from './authService';
interface AuthState {firebaseUser:User|null;userProfile:UserProfile|null;loading:boolean;profileError:string;refreshProfile:()=>Promise<void>;}
const Context=createContext<AuthState|null>(null);
export function AuthProvider({children}:{children:ReactNode}){
 const [firebaseUser,setUser]=useState<User|null>(null),[userProfile,setProfile]=useState<UserProfile|null>(null),[loading,setLoading]=useState(true),[profileError,setError]=useState('');const generation=useRef(0);
 async function refreshProfile(){const u=auth?.currentUser,epoch=generation.current;if(!u?.email)return;try{const snap=await getDoc(userRef(u.email));if(epoch!==generation.current||auth?.currentUser?.uid!==u.uid)return;setProfile(snap.exists()?snap.data() as UserProfile:null);setError(snap.exists()?'':'กำลังสร้างโปรไฟล์');}catch{if(epoch===generation.current)setError('โหลดโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่');}}
 useEffect(()=>{let stopAuth=()=>{},stopProfile=()=>{},active=true;if(!auth){setLoading(false);return;}setPersistence(auth,browserLocalPersistence).then(()=>{if(!active)return;stopAuth=onAuthStateChanged(auth!,u=>{generation.current++;const epoch=generation.current;stopProfile();setUser(u);setProfile(null);setError('');if(!u?.email){setLoading(false);return;}setLoading(true);stopProfile=onSnapshot(userRef(u.email),snap=>{if(!active||epoch!==generation.current)return;setProfile(snap.exists()?snap.data() as UserProfile:null);setLoading(false);},()=>{if(active&&epoch===generation.current){setError('โหลดโปรไฟล์ไม่สำเร็จ กรุณาตรวจ Firestore Rules แล้วลองใหม่');setLoading(false);}});});}).catch(()=>{if(active){setError('ไม่สามารถจดจำการเข้าสู่ระบบ กรุณาอนุญาต Local Storage');setLoading(false);}});return()=>{active=false;generation.current++;stopAuth();stopProfile();};},[]);
 return <Context.Provider value={{firebaseUser,userProfile,loading,profileError,refreshProfile}}>{children}</Context.Provider>;
}
export function useAuth(){const value=useContext(Context);if(!value)throw Error('AuthProvider required');return value;}
export function AuthSpinner(){return <div className="auth-loading" role="status" aria-live="polite"><span className="auth-spinner"/>กำลังตรวจสอบการเข้าสู่ระบบ…</div>;}
