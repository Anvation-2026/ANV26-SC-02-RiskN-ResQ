import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS } from './strings';
import { loadJSON, saveJSON } from '../services/storage';

const KEY = 'risknresq_lang';
const Ctx = createContext({ lang: 'en', setLang: () => {}, t: (k) => k });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('en');
  useEffect(() => { loadJSON(KEY).then((l) => { if (l && STRINGS[l]) setLangState(l); }); }, []);
  const setLang = useCallback((l) => { if (STRINGS[l]) { setLangState(l); saveJSON(KEY, l); } }, []);
  const t = useCallback((key, vars) => {
    let s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace(`{${k}}`, vars[k]); });
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
