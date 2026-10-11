export const providers={openai:'OpenAI',anthropic:'Anthropic',google:'Google AI Studio'};
export const models={openai:['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'],anthropic:['claude-opus-5-5','claude-sonnet-5-5'],google:['gemini-3.8-flash','gemini-3.1-pro-preview']};
export const defaultProvider='openai';
export const defaultModel='gpt-6-luna';
export const defaultEffort='xhigh';
export const effortOptions={
 openai:[{value:'off',label:'Off'},{value:'low',label:'Light'},{value:'medium',label:'Medium'},{value:'high',label:'High'},{value:'xhigh',label:'Extra high'}],
 anthropic:[{value:'off',label:'Off'},{value:'low',label:'Light'},{value:'medium',label:'Medium'},{value:'high',label:'High'},{value:'xhigh',label:'Extra high'},{value:'max',label:'Max'}],
 google:[{value:'low',label:'Light'},{value:'medium',label:'Medium'},{value:'high',label:'High'}],
};
