export const parseJson = 'c.body=await pj(c)\n'
export const parseUrlencoded = 'c.body=await pu(c)\n'
export const parseArrayBuffer = 'c.body=await pa(c)\n'
export const parseFormData = 'c.body=await pf(c)\n'
export const parseText = 'c.body=await pt(c)\n'

export const defaultParse = `if(ct)
switch(ct.charCodeAt(12)){
case 106:
${parseJson}break
case 120:
${parseUrlencoded}break
case 111:
${parseArrayBuffer}break
case 114:
${parseFormData}break
default:
if(contentType.charCodeAt(0)===116)
${parseText}break
}`
