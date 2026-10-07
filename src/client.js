import {createClient} from '@supabase/supabase-js';
import {publicOriginFrom} from './lib';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase=url&&key?createClient(url,key):null;
export const publicOrigin=publicOriginFrom(import.meta.env.VITE_PUBLIC_APP_URL, window.location.origin);
export async function resolveImages(card) {
  const result={...card};
  for(const kind of ['avatar','logo'])if(card[kind+'_path']){
    const {data,error}=await supabase.storage.from('card-images').createSignedUrl(card[kind+'_path'],120);
    if(!error)result[kind+'Url']=data.signedUrl;
  }
  return result;
}
