import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { Globe } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useAuth } from '../context/AuthContext'
import FileTree from '../components/FileTree'
import Terminal from '../components/Terminal'
import InteractiveConsole from '../components/InteractiveConsole'
import VoiceChannelPanel from '../components/VoiceChannelPanel'
import AIChatPopup from '../components/AIChatPopup'
import '../styles/ProjectPage.css'

const DEFAULT_AVATAR_PATH = '/branding/defaultAvatar.png'
const TYPING_ACTIVE_WINDOW_MS = 6000
const TYPING_SIGNAL_WINDOW_MS = 1800
const COLLAB_ACK_TIMEOUT_MS = 2500
const CURSOR_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185', '#f97316']
const GHOST_SUGGESTION_DEBOUNCE_MS = 620
const GHOST_CONTEXT_WINDOW_LINES = 30
const GHOST_PROJECT_SUMMARY_MAX_FILES = 24

const SNIPPET_LANGUAGE_IDS = ['javascript', 'typescript', 'html', 'css', 'json']
const REACT_COMPONENT_NAME_SNIPPET = '${1:${TM_FILENAME_BASE/(.*)/${1:/pascalcase}/}}'
const EMMET_HTML_SNIPPETS = [
  {
    prefix: 'div',
    description: 'div element',
    detail: 'Emmet Abbreviation',
    body: '<div>${1}</div>$0',
  },
  {
    prefix: 'span',
    description: 'span element',
    detail: 'Emmet Abbreviation',
    body: '<span>${1}</span>$0',
  },
  {
    prefix: 'p',
    description: 'paragraph element',
    detail: 'Emmet Abbreviation',
    body: '<p>${1}</p>$0',
  },
  {
    prefix: 'a',
    description: 'anchor element',
    detail: 'Emmet Abbreviation',
    body: '<a href="${1:#}">${2:link}</a>$0',
  },
  {
    prefix: 'img',
    description: 'image element',
    detail: 'Emmet Abbreviation',
    body: '<img src="${1:}" alt="${2:}" />$0',
  },
  {
    prefix: 'ul>li',
    description: 'unordered list item',
    detail: 'Emmet Abbreviation',
    body: '<ul>\n  <li>${1}</li>\n</ul>$0',
  },
  {
    prefix: 'ol>li',
    description: 'ordered list item',
    detail: 'Emmet Abbreviation',
    body: '<ol>\n  <li>${1}</li>\n</ol>$0',
  },
  {
    prefix: 'input:text',
    description: 'text input',
    detail: 'Emmet Abbreviation',
    body: '<input type="text" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'button',
    description: 'button element',
    detail: 'Emmet Abbreviation',
    body: '<button type="button">${1:Button}</button>$0',
  },
  {
    prefix: 'form',
    description: 'form element',
    detail: 'Emmet Abbreviation',
    body: '<form action="${1:#}" method="${2:post}">${3}</form>$0',
  },
  {
    prefix: 'label',
    description: 'label element',
    detail: 'Emmet Abbreviation',
    body: '<label for="${1:input}">${2:Label}</label>$0',
  },
  {
    prefix: 'textarea',
    description: 'textarea element',
    detail: 'Emmet Abbreviation',
    body: '<textarea name="${1:name}" id="${2:id}" rows="${3:3}" cols="${4:50}"></textarea>$0',
  },
  {
    prefix: 'select',
    description: 'select dropdown',
    detail: 'Emmet Abbreviation',
    body: '<select name="${1:name}" id="${2:id}">\n  <option value="${3:value}">${4:option}</option>\n</select>$0',
  },
  {
    prefix: 'input:checkbox',
    description: 'checkbox input',
    detail: 'Emmet Abbreviation',
    body: '<input type="checkbox" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'input:radio',
    description: 'radio input',
    detail: 'Emmet Abbreviation',
    body: '<input type="radio" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'input:email',
    description: 'email input',
    detail: 'Emmet Abbreviation',
    body: '<input type="email" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'input:password',
    description: 'password input',
    detail: 'Emmet Abbreviation',
    body: '<input type="password" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'script',
    description: 'script tag',
    detail: 'Emmet Abbreviation',
    body: '<script src="${1:}"></script>$0',
  },
  {
    prefix: 'link:css',
    description: 'link CSS stylesheet',
    detail: 'Emmet Abbreviation',
    body: '<link rel="stylesheet" href="${1:}.css" />$0',
  },
]

const EMMET_JSX_SNIPPETS = [
  {
    prefix: 'div',
    description: 'div element',
    detail: 'Emmet Abbreviation',
    body: '<div>${1}</div>$0',
  },
  {
    prefix: 'span',
    description: 'span element',
    detail: 'Emmet Abbreviation',
    body: '<span>${1}</span>$0',
  },
  {
    prefix: 'p',
    description: 'paragraph element',
    detail: 'Emmet Abbreviation',
    body: '<p>${1}</p>$0',
  },
  {
    prefix: 'a',
    description: 'anchor element',
    detail: 'Emmet Abbreviation',
    body: '<a href="${1:#}">${2:link}</a>$0',
  },
  {
    prefix: 'img',
    description: 'image element',
    detail: 'Emmet Abbreviation',
    body: '<img src="${1:}" alt="${2:}" />$0',
  },
  {
    prefix: 'input:text',
    description: 'text input',
    detail: 'Emmet Abbreviation',
    body: '<input type="text" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'button',
    description: 'button element',
    detail: 'Emmet Abbreviation',
    body: '<button type="button">${1:Button}</button>$0',
  },
  {
    prefix: 'form',
    description: 'form element with React handler',
    detail: 'Emmet Abbreviation',
    body: '<form onSubmit={${1:handleSubmit}}>\n  ${2}\n</form>$0',
  },
  {
    prefix: 'label',
    description: 'label element for JSX',
    detail: 'Emmet Abbreviation',
    body: '<label htmlFor="${1:input}">${2:Label}</label>$0',
  },
  {
    prefix: 'input:checkbox',
    description: 'checkbox input',
    detail: 'Emmet Abbreviation',
    body: '<input type="checkbox" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'input:email',
    description: 'email input',
    detail: 'Emmet Abbreviation',
    body: '<input type="email" name="${1:name}" id="${2:id}" />$0',
  },
  {
    prefix: 'textarea',
    description: 'textarea element',
    detail: 'Emmet Abbreviation',
    body: '<textarea name="${1:name}" id="${2:id}" rows="${3:3}" cols="${4:50}"></textarea>$0',
  },
  {
    prefix: 'section',
    description: 'section element',
    detail: 'Emmet Abbreviation',
    body: '<section>${1}</section>$0',
  },
  {
    prefix: 'main',
    description: 'main element',
    detail: 'Emmet Abbreviation',
    body: '<main>${1}</main>$0',
  },
]

const UNIVERSAL_SNIPPETS = {
  javascript: [
    {
      prefix: 'clg',
      description: 'Console log',
      body: "console.log('${1:value}')",
    },
    {
      prefix: 'fn',
      description: 'Function declaration',
      body: 'function ${1:name}(${2:params}) {\n  ${3:// code}\n}',
    },
    {
      prefix: 'afn',
      description: 'Arrow function',
      body: 'const ${1:name} = (${2:params}) => {\n  ${3:// code}\n}',
    },
    {
      prefix: 'tryc',
      description: 'Try catch block',
      body: 'try {\n  ${1:// code}\n} catch (${2:error}) {\n  console.error(${2:error})\n}',
    },
    {
      prefix: 'arr',
      description: 'Array literal',
      body: '[${1}]',
    },
    {
      prefix: 'obj',
      description: 'Object literal',
      body: '{\n  ${1:key}: ${2:value},\n}',
    },
    {
      prefix: 'for',
      description: 'For loop',
      body: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${3}\n}',
    },
    {
      prefix: 'foreach',
      description: 'forEach loop',
      body: '${1:array}.forEach((${2:item}) => {\n  ${3}\n})',
    },
    {
      prefix: 'while',
      description: 'While loop',
      body: 'while (${1:condition}) {\n  ${2:// code}\n}',
    },
    {
      prefix: 'switch',
      description: 'Switch case',
      body: 'switch (${1:value}) {\n  case ${2:case}:\n    ${3:// code}\n    break\n  default:\n    ${4}\n}',
    },
    {
      prefix: 'const',
      description: 'Const variable',
      body: 'const ${1:name} = ${2:value}',
    },
    {
      prefix: 'let',
      description: 'Let variable',
      body: 'let ${1:name} = ${2:value}',
    },
    {
      prefix: 'ifelse',
      description: 'If else block',
      body: 'if (${1:condition}) {\n  ${2:// code}\n} else {\n  ${3:// code}\n}',
    },
    {
      prefix: 'async',
      description: 'Async function',
      body: 'async function ${1:name}(${2:params}) {\n  ${3:// code}\n}',
    },
    {
      prefix: 'aw',
      description: 'Await expression',
      body: 'await ${1:promise}',
    },
  ],
  typescript: [
    {
      prefix: 'clg',
      description: 'Console log',
      body: "console.log('${1:value}')",
    },
    {
      prefix: 'fn',
      description: 'Typed function declaration',
      body: 'function ${1:name}(${2:params}): ${3:void} {\n  ${4:// code}\n}',
    },
    {
      prefix: 'afn',
      description: 'Typed arrow function',
      body: 'const ${1:name} = (${2:params}): ${3:void} => {\n  ${4:// code}\n}',
    },
    {
      prefix: 'itype',
      description: 'Interface declaration',
      body: 'interface ${1:Name} {\n  ${2:key}: ${3:string}\n}',
    },
    {
      prefix: 'type',
      description: 'Type alias',
      body: 'type ${1:Name} = {\n  ${2:key}: ${3:string}\n}',
    },
    {
      prefix: 'arr',
      description: 'Array literal',
      body: '[${1}] as ${2:Type}[]',
    },
    {
      prefix: 'obj',
      description: 'Typed object literal',
      body: 'const ${1:obj}: ${2:Type} = {\n  ${3:key}: ${4:value},\n}',
    },
    {
      prefix: 'for',
      description: 'For loop',
      body: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${3}\n}',
    },
    {
      prefix: 'foreach',
      description: 'forEach loop',
      body: '${1:array}.forEach((${2:item}) => {\n  ${3}\n})',
    },
    {
      prefix: 'async',
      description: 'Async function',
      body: 'async function ${1:name}(${2:params}): Promise<${3:void}> {\n  ${4:// code}\n}',
    },
    {
      prefix: 'aw',
      description: 'Await expression',
      body: 'await ${1:promise}',
    },
  ],
  html: [
    {
      prefix: '!',
      description: 'HTML5 boilerplate',
      detail: 'Emmet Abbreviation',
      body:
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${1:Document}</title>\n</head>\n<body>\n  ${2}\n</body>\n</html>',
    },
  ],
  css: [
    {
      prefix: 'center',
      description: 'Center with flexbox',
      body: 'display: flex;\nalign-items: center;\njustify-content: center;',
    },
  ],
  json: [
    {
      prefix: 'pkgscripts',
      description: 'package.json scripts block',
      body: '"scripts": {\n  "dev": "${1:vite}",\n  "build": "${2:vite build}",\n  "start": "${3:node index.js}"\n}',
    },
  ],
}

const TEMPLATE_SNIPPETS = {
  react: {
    javascript: [
      {
        prefix: 'rafc',
        description: 'React arrow function component',
        detail: 'reactArrowFunctionComponent',
        body:
          `import React from 'react'\n\nconst ${REACT_COMPONENT_NAME_SNIPPET} = () => {\n  return (\n    <div>$1</div>\n  )\n}\n\n$0`,
      },
      {
        prefix: 'rafce',
        description: 'React arrow function component export',
        detail: 'reactArrowFunctionExportComponent',
        body:
          `import React from 'react'\n\nconst ${REACT_COMPONENT_NAME_SNIPPET} = () => {\n  return (\n    <div>$1</div>\n  )\n}\n\nexport default $1\n$0`,
      },
      {
        prefix: 'rafcp',
        description: 'React arrow function component with PropTypes',
        detail: 'reactArrowFunctionComponentWithPropTypes',
        body:
          `import React from 'react'\nimport PropTypes from 'prop-types'\n\nconst ${REACT_COMPONENT_NAME_SNIPPET} = (props) => {\n  return (\n    <div>$1</div>\n  )\n}\n\n$1.propTypes = {\n  \${2:value}: PropTypes.\${3:string},\n}\n\nexport default $1\n$0`,
      },
      {
        prefix: 'rfc',
        description: 'React function component',
        detail: 'reactFunctionComponent',
        body: `import React from 'react'\n\nfunction ${REACT_COMPONENT_NAME_SNIPPET}() {\n  return (\n    <div>$1</div>\n  )\n}\n\nexport default $1\n$0`,
      },
      {
        prefix: 'usest',
        description: 'useState hook',
        body: "const [${1:state}, set${2:State}] = useState(${3:null})",
      },
      {
        prefix: 'uef',
        description: 'useEffect hook',
        body: 'useEffect(() => {\n  ${1:// effect}\n\n  return () => {\n    ${2:// cleanup}\n  }\n}, [${3}])',
      },
      {
        prefix: 'ucb',
        description: 'useCallback hook',
        body: 'const ${1:handler} = useCallback(() => {\n  ${2:// code}\n}, [${3}])',
      },
      {
        prefix: 'umemo',
        description: 'useMemo hook',
        body: 'const ${1:value} = useMemo(() => {\n  ${2:return computedValue}\n}, [${3}])',
      },
      {
        prefix: 'uref',
        description: 'useRef hook',
        body: 'const ${1:refName} = useRef(${2:null})',
      },
      {
        prefix: 'imr',
        description: 'Import React',
        body: "import React from 'react'",
      },
      {
        prefix: 'imrs',
        description: 'Import React and useState',
        body: "import React, { useState } from 'react'",
      },
      {
        prefix: 'imrse',
        description: 'Import React, useState, useEffect',
        body: "import React, { useEffect, useState } from 'react'",
      },
      {
        prefix: 'props',
        description: 'Destructure props in component',
        body: 'const { ${1} } = props',
      },
      {
        prefix: 'context',
        description: 'React context',
        body:
          "import { createContext, useContext } from 'react'\n\nconst ${1:App}Context = createContext(${2:null})\n\nexport const use${1:App}Context = () => useContext(${1:App}Context)",
      },
      {
        prefix: 'redu',
        description: 'useReducer hook',
        body:
          'const [state, dispatch] = useReducer((${1:state}, ${2:action}) => {\n  switch (${2:action}.type) {\n    case ${3:\'SET_VALUE\'}:\n      return { ...${1:state}, ${4:value}: ${2:action}.payload }\n    default:\n      return ${1:state}\n  }\n}, ${5:initialState})',
      },
      {
        prefix: 'mapjsx',
        description: 'Array map in JSX',
        body: '{${1:items}.map((${2:item}) => (\n  <${3:div} key={${2:item}.${4:id}}>${5}</${3:div}>\n))}',
      },
      {
        prefix: 'cc',
        description: 'Class component',
        detail: 'reactClassComponent',
        body: `import React from 'react'\n\nclass ${REACT_COMPONENT_NAME_SNIPPET} extends React.Component {\n  render() {\n    return (\n      <div>$1</div>\n    )\n  }\n}\n\nexport default ${REACT_COMPONENT_NAME_SNIPPET}\n$0`,
      },
      {
        prefix: 'export',
        description: 'Export default',
        body: 'export default ${1:component}',
      },
      {
        prefix: 'ternary',
        description: 'Ternary operator in JSX',
        body: '{${1:condition} ? <${2:div}>${3}</${2:div}> : <${4:div}>${5}</${4:div}>}',
      },
      {
        prefix: 'conditional',
        description: 'Conditional rendering',
        body: '{${1:condition} && <${2:div}>${3}</${2:div}>}',
      },
    ],
    typescript: [
      {
        prefix: 'rafc',
        description: 'React TS arrow function component',
        detail: 'reactArrowFunctionComponent',
        body:
          `import React from 'react'\n\nconst ${REACT_COMPONENT_NAME_SNIPPET} = () => {\n  return (\n    <div>$1</div>\n  )\n}\n\n$0`,
      },
      {
        prefix: 'rafce',
        description: 'React TS arrow function component export',
        detail: 'reactArrowFunctionExportComponent',
        body:
          `import React from 'react'\n\nconst ${REACT_COMPONENT_NAME_SNIPPET} = () => {\n  return (\n    <div>$1</div>\n  )\n}\n\nexport default $1\n$0`,
      },
      {
        prefix: 'uset',
        description: 'Typed useState hook',
        body: "const [${1:state}, set${2:State}] = useState<${3:string}>(${4:''})",
      },
      {
        prefix: 'uef',
        description: 'useEffect hook',
        body: 'useEffect(() => {\n  ${1:// effect}\n\n  return () => {\n    ${2:// cleanup}\n  }\n}, [${3}])',
      },
      {
        prefix: 'ucb',
        description: 'Typed useCallback hook',
        body: 'const ${1:handler} = useCallback((): ${2:void} => {\n  ${3:// code}\n}, [${4}])',
      },
      {
        prefix: 'umemo',
        description: 'Typed useMemo hook',
        body: 'const ${1:value} = useMemo<${2:string}>(() => {\n  ${3:return computedValue}\n}, [${4}])',
      },
      {
        prefix: 'imr',
        description: 'Import React',
        body: "import React from 'react'",
      },
      {
        prefix: 'imrse',
        description: 'Import React, useState, useEffect',
        body: "import React, { useEffect, useState } from 'react'",
      },
      {
        prefix: 'usetype',
        description: 'Type alias',
        body: 'type ${1:Name} = {\n  ${2:key}: ${3:string}\n}',
      },
      {
        prefix: 'iface',
        description: 'Interface props block',
        body: 'interface ${1:Name}Props {\n  ${2:key}: ${3:string}\n}',
      },
      {
        prefix: 'context',
        description: 'Typed React context',
        body:
          "type ${1:App}ContextValue = {\n  ${2:value}: ${3:string}\n}\n\nconst ${1:App}Context = createContext<${1:App}ContextValue | null>(null)\n\nexport const use${1:App}Context = () => {\n  const context = useContext(${1:App}Context)\n  if (!context) throw new Error('${1:App}Context missing provider')\n  return context\n}",
      },
      {
        prefix: 'redu',
        description: 'Typed useReducer hook',
        body:
          'type ${1:Action} = { type: ${2:\'SET_VALUE\'}; payload: ${3:string} }\n\nconst [state, dispatch] = useReducer((${4:state}: ${5:State}, action: ${1:Action}) => {\n  switch (action.type) {\n    case ${2:\'SET_VALUE\'}:\n      return { ...${4:state}, ${6:value}: action.payload }\n    default:\n      return ${4:state}\n  }\n}, ${7:initialState})',
      },
      {
        prefix: 'mapjsx',
        description: 'Typed array map in JSX',
        body: '{${1:items}.map((${2:item}) => (\n  <${3:div} key={${2:item}.${4:id}}>${5}</${3:div}>\n))}',
      },
      {
        prefix: 'ternary',
        description: 'Ternary operator in JSX',
        body: '{${1:condition} ? <${2:div}>${3}</${2:div}> : <${4:div}>${5}</${4:div}>}',
      },
      {
        prefix: 'conditional',
        description: 'Conditional rendering',
        body: '{${1:condition} && <${2:div}>${3}</${2:div}>}',
      },
      {
        prefix: 'export',
        description: 'Export default',
        body: 'export default ${1:component}',
      },
    ],
  },
  vue: {
    html: [
      {
        prefix: 'vbase',
        description: 'Vue SFC with script setup',
        body:
          '<script setup${1: lang="ts"}>\n${2}\n</script>\n\n<template>\n  <div class="${3:container}">\n    ${4}\n  </div>\n</template>\n\n<style scoped>\n.${3:container} {\n  ${5}\n}\n</style>',
      },
    ],
    javascript: [
      {
        prefix: 'vref',
        description: 'Vue ref()',
        body: "const ${1:value} = ref(${2:null})",
      },
      {
        prefix: 'vcomputed',
        description: 'Vue computed()',
        body: 'const ${1:computedValue} = computed(() => {\n  ${2:return value}\n})',
      },
      {
        prefix: 'vwatch',
        description: 'Vue watch()',
        body: 'watch(() => ${1:source}, (${2:newValue}) => {\n  ${3:// code}\n})',
      },
      {
        prefix: 'vonmounted',
        description: 'Vue onMounted()',
        body: 'onMounted(() => {\n  ${1:// code}\n})',
      },
      {
        prefix: 'vemit',
        description: 'Vue defineEmits()',
        body: "const emit = defineEmits(['${1:submit}'])",
      },
      {
        prefix: 'vprops',
        description: 'Vue defineProps()',
        body: 'const props = defineProps({\n  ${1:title}: {\n    type: ${2:String},\n    required: ${3:true},\n  },\n})',
      },
      {
        prefix: 'vonunmounted',
        description: 'Vue onUnmounted()',
        body: 'onUnmounted(() => {\n  ${1:// code}\n})',
      },
      {
        prefix: 'vonerror',
        description: 'Vue onErrorCaptured()',
        body: 'onErrorCaptured((err) => {\n  ${1:// code}\n})',
      },
    ],
    typescript: [
      {
        prefix: 'vref',
        description: 'Typed Vue ref()',
        body: 'const ${1:value} = ref<${2:string}>(${3:""})',
      },
      {
        prefix: 'vcomputed',
        description: 'Vue computed()',
        body: 'const ${1:computedValue} = computed<${2:string}>(() => {\n  ${3:return value}\n})',
      },
      {
        prefix: 'vprops',
        description: 'Typed Vue defineProps()',
        body: 'type ${1:Props} = {\n  ${2:title}: ${3:string}\n}\n\nconst props = defineProps<${1:Props}>()',
      },
      {
        prefix: 'vemit',
        description: 'Typed Vue defineEmits()',
        body: 'const emit = defineEmits<{\n  (${1:event}: ${2:\'submit\'}, ${3:payload}: ${4:string}): void\n}>()',
      },
      {
        prefix: 'vonmounted',
        description: 'Vue onMounted()',
        body: 'onMounted(() => {\n  ${1:// code}\n})',
      },
      {
        prefix: 'vwatch',
        description: 'Vue watch()',
        body: 'watch(() => ${1:source}, (${2:newValue}) => {\n  ${3:// code}\n})',
      },
      {
        prefix: 'vonunmounted',
        description: 'Vue onUnmounted()',
        body: 'onUnmounted(() => {\n  ${1:// code}\n})',
      },
      {
        prefix: 'vonerror',
        description: 'Vue onErrorCaptured()',
        body: 'onErrorCaptured((err) => {\n  ${1:// code}\n})',
      },
    ],
  },
  nodeExpress: {
    javascript: [
      {
        prefix: 'exproute',
        description: 'Express route handler',
        body: "router.${1|get,get|post|put|patch|delete|}('${2:/path}', async (req, res) => {\n  ${3:res.json({ ok: true })}\n})",
      },
      {
        prefix: 'expmw',
        description: 'Express middleware',
        body: 'const ${1:middlewareName} = (req, res, next) => {\n  ${2:// code}\n  next()\n}\n\nexport default ${1:middlewareName}',
      },
      {
        prefix: 'expserver',
        description: 'Express app bootstrap',
        body:
          "import express from 'express'\n\nconst app = express()\n\napp.use(express.json())\n\napp.get('${1:/}', (_req, res) => {\n  res.json({ ok: true })\n})\n\napp.listen(${2:3000}, () => {\n  console.log('Server running on port ${2:3000}')\n})",
      },
      {
        prefix: 'expasync',
        description: 'Async Express handler',
        body: 'const ${1:handler} = async (req, res) => {\n  try {\n    ${2:res.json({ ok: true })}\n  } catch (${3:error}) {\n    res.status(500).json({ message: ${3:error}.message })\n  }\n}',
      },
      {
        prefix: 'expmodel',
        description: 'Simple module export',
        body: 'export const ${1:name} = {\n  ${2:key}: ${3:value},\n}',
      },
      {
        prefix: 'imdc',
        description: 'Import/require module',
        body: "const ${1:module} = require('${2:module-name}')",
      },
      {
        prefix: 'expjson',
        description: 'Express JSON response',
        body: 'res.json({ ${1:key}: ${2:value} })',
      },
    ],
    typescript: [
      {
        prefix: 'exproute',
        description: 'Express typed route handler',
        body:
          "router.${1|get,get|post|put|patch|delete|}('${2:/path}', async (req: Request, res: Response) => {\n  ${3:res.json({ ok: true })}\n})",
      },
      {
        prefix: 'expctrl',
        description: 'Express controller function',
        body: 'export const ${1:controllerName} = async (req: Request, res: Response): Promise<void> => {\n  ${2:res.json({ ok: true })}\n}',
      },
      {
        prefix: 'expmw',
        description: 'Typed Express middleware',
        body: 'export const ${1:middlewareName} = (req: Request, res: Response, next: NextFunction): void => {\n  ${2:// code}\n  next()\n}',
      },
      {
        prefix: 'expserver',
        description: 'Typed Express app bootstrap',
        body:
          "import express from 'express'\n\nconst app = express()\n\napp.use(express.json())\n\napp.get('${1:/}', (_req, res) => {\n  res.json({ ok: true })\n})\n\napp.listen(${2:3000}, () => {\n  console.log('Server running on port ${2:3000}')\n})",
      },
      {
        prefix: 'exptype',
        description: 'API response type',
        body: 'type ${1:ApiResponse} = {\n  ok: boolean\n  ${2:data}?: ${3:string}\n  ${4:message}?: string\n}',
      },
      {
        prefix: 'imdc',
        description: 'Import module',
        body: "import ${1:module} from '${2:module-name}'",
      },
      {
        prefix: 'expjson',
        description: 'Express JSON response',
        body: 'res.json({ ${1:key}: ${2:value} })',
      },
    ],
  },
}

const resolveSnippetTemplateKey = (templateId = '') => {
  const normalized = String(templateId || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'react-vite' || normalized === 'react-ts-tailwind' || normalized === 'nextjs-app') return 'react'
  if (normalized === 'vue-vite') return 'vue'
  if (normalized === 'node-express') return 'nodeExpress'
  return ''
}

const buildSnippetEntriesForContext = ({ languageId, templateId, projectType, filePath }) => {
  const normalizedProjectType = String(projectType || '').trim().toLowerCase()
  if (normalizedProjectType === 'practice') {
    // DSA/practice mode intentionally stays distraction-free in phase 1.
    return []
  }

  const normalizedLanguage = String(languageId || '').trim().toLowerCase()
  const normalizedPath = normalizePath(filePath || '').toLowerCase()
  const templateKey = resolveSnippetTemplateKey(templateId)
  const templateBundle = TEMPLATE_SNIPPETS[templateKey] || {}

  const entries = []
  if (Array.isArray(UNIVERSAL_SNIPPETS[normalizedLanguage])) {
    entries.push(...UNIVERSAL_SNIPPETS[normalizedLanguage])
  }

  const isJsxLikeFile = normalizedPath.endsWith('.jsx') || normalizedPath.endsWith('.tsx')
  if (isJsxLikeFile && (normalizedLanguage === 'javascript' || normalizedLanguage === 'typescript')) {
    // VS Code users expect Emmet-style ! boilerplate while editing JSX/TSX files too.
    entries.push(...(UNIVERSAL_SNIPPETS.html || []))
    entries.push(...EMMET_JSX_SNIPPETS)
  }

  if (normalizedLanguage === 'html') {
    entries.push(...EMMET_HTML_SNIPPETS)
  }

  if (Array.isArray(templateBundle[normalizedLanguage])) {
    entries.push(...templateBundle[normalizedLanguage])
  }

  if (templateKey === 'vue' && normalizedLanguage === 'html' && normalizedPath.endsWith('.vue')) {
    entries.push(...(templateBundle.html || []))
  }

  const deduped = new Map()
  for (const entry of entries) {
    const key = `${String(entry?.prefix || '').trim()}::${String(entry?.description || '').trim()}`
    if (!key || deduped.has(key)) continue
    deduped.set(key, entry)
  }

  return Array.from(deduped.values())
}

const rankSnippetEntries = (entries = [], typedWord = '') => {
  const normalizedTypedWord = String(typedWord || '').trim().toLowerCase()
  const source = Array.isArray(entries) ? entries : []

  if (!normalizedTypedWord) {
    return [...source].sort((a, b) => String(a?.prefix || '').localeCompare(String(b?.prefix || '')))
  }

  const exactMatches = []
  const startsWithMatches = []
  const includesMatches = []

  for (const entry of source) {
    const prefix = String(entry?.prefix || '').trim()
    if (!prefix) continue
    const normalizedPrefix = prefix.toLowerCase()

    if (normalizedPrefix === normalizedTypedWord) {
      exactMatches.push(entry)
      continue
    }

    if (normalizedPrefix.startsWith(normalizedTypedWord)) {
      startsWithMatches.push(entry)
      continue
    }

    if (normalizedPrefix.includes(normalizedTypedWord)) {
      includesMatches.push(entry)
    }
  }

  startsWithMatches.sort((a, b) => {
    const aPrefix = String(a?.prefix || '')
    const bPrefix = String(b?.prefix || '')
    const aDiff = Math.abs(aPrefix.length - normalizedTypedWord.length)
    const bDiff = Math.abs(bPrefix.length - normalizedTypedWord.length)
    if (aDiff !== bDiff) return aDiff - bDiff
    return aPrefix.localeCompare(bPrefix)
  })

  exactMatches.sort((a, b) => String(a?.prefix || '').localeCompare(String(b?.prefix || '')))
  includesMatches.sort((a, b) => String(a?.prefix || '').localeCompare(String(b?.prefix || '')))

  return [...exactMatches, ...startsWithMatches, ...includesMatches]
}

const extractSnippetQuery = (model, position) => {
  const lineNumber = Number(position?.lineNumber || 1)
  const column = Number(position?.column || 1)
  const lineContent = String(model?.getLineContent?.(lineNumber) || '')
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1))
  const tokenMatch = linePrefix.match(/([!#.\w:+>*-]+)$/)

  if (tokenMatch?.[1]) {
    const query = tokenMatch[1]
    return {
      query,
      range: {
        startLineNumber: lineNumber,
        endLineNumber: lineNumber,
        startColumn: column - query.length,
        endColumn: column,
      },
    }
  }

  const word = model?.getWordUntilPosition?.(position) || { word: '', startColumn: column, endColumn: column }
  return {
    query: String(word.word || '').trim(),
    range: {
      startLineNumber: lineNumber,
      endLineNumber: lineNumber,
      startColumn: Number(word.startColumn || column),
      endColumn: Number(word.endColumn || column),
    },
  }
}

const parseEmmetSegment = (segment = '') => {
  let source = String(segment || '').trim()
  if (!source) return null

  let repeat = 1
  const repeatMatch = source.match(/\*(\d+)$/)
  if (repeatMatch?.[1]) {
    repeat = Math.min(12, Math.max(1, Number(repeatMatch[1]) || 1))
    source = source.slice(0, source.length - repeatMatch[0].length)
  }

  const idMatch = source.match(/#([A-Za-z_][\w-]*)/)
  const classMatches = [...source.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1])
  const tagMatch = source.match(/^([A-Za-z][\w-]*)/)
  const tag = String(tagMatch?.[1] || '').trim() || 'div'

  if (!tag) return null
  return {
    tag,
    id: idMatch?.[1] || '',
    classes: classMatches,
    repeat,
  }
}

const buildEmmetSnippetBody = (abbreviation = '', { useJsxAttrs = false } = {}) => {
  const text = String(abbreviation || '').trim()
  if (!text || /[\s()[\]{}]/.test(text)) return ''

  if (text === '!') {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${1:Document}</title>\n</head>\n<body>\n  ${2}\n</body>\n</html>\n$0'
  }

  const segments = text.split('>').map((part) => parseEmmetSegment(part)).filter(Boolean)
  if (!segments.length) return ''

  const indentUnit = '  '
  const buildAttrs = (segment) => {
    const attrs = []
    if (segment.id) attrs.push(`id="${segment.id}"`)
    if (segment.classes.length) {
      const classKey = useJsxAttrs ? 'className' : 'class'
      attrs.push(`${classKey}="${segment.classes.join(' ')}"`)
    }
    return attrs.length ? ` ${attrs.join(' ')}` : ''
  }

  const renderSegment = (index, depth) => {
    const segment = segments[index]
    if (!segment) return ''

    const indent = indentUnit.repeat(depth)
    const attrs = buildAttrs(segment)
    const open = `<${segment.tag}${attrs}>`
    const close = `</${segment.tag}>`
    const isLeaf = index === segments.length - 1

    if (isLeaf) {
      if (segment.repeat > 1) {
        const lines = []
        for (let i = 0; i < segment.repeat; i += 1) {
          const content = i === 0 ? '${1}' : ''
          lines.push(`${indent}${open}${content}${close}`)
        }
        return lines.join('\n')
      }
      return `${indent}${open}${'${1}'}${close}`
    }

    const child = renderSegment(index + 1, depth + 1)
    const count = Math.max(1, segment.repeat)
    const blocks = []
    for (let i = 0; i < count; i += 1) {
      blocks.push(`${indent}${open}\n${child}\n${indent}${close}`)
    }
    return blocks.join('\n')
  }

  const body = renderSegment(0, 0)
  return body ? `${body}\n$0` : ''
}

const isPascalCase = (value = '') => /^[A-Z][A-Za-z0-9_$]*$/.test(String(value || '').trim())

const extractExportedSymbols = (source = '') => {
  const text = String(source || '')
  const symbols = new Set()

  const patterns = [
    /export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match?.[1]) symbols.add(String(match[1]))
    }
  }

  return Array.from(symbols)
}

const pickCursorColor = (userId = '') => {
  const source = String(userId || '')
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0
  }
  const offset = Math.abs(hash) % CURSOR_COLORS.length
  return CURSOR_COLORS[offset]
}

const chatMessageKey = (message) => String(message?.id || message?.clientMessageId || '').trim()

const mergeChatMessages = (snapshotChat, previousChat) => {
  const normalizedSnapshot = Array.isArray(snapshotChat) ? snapshotChat : []
  const normalizedPrevious = Array.isArray(previousChat) ? previousChat : []

  if (!normalizedPrevious.length) return normalizedSnapshot

  const mergedByKey = new Map()
  const fallbackItems = []

  for (const message of normalizedSnapshot) {
    const key = chatMessageKey(message)
    if (key) {
      mergedByKey.set(key, message)
    } else {
      fallbackItems.push(message)
    }
  }

  for (const message of normalizedPrevious) {
    const key = chatMessageKey(message)
    if (key) {
      if (!mergedByKey.has(key)) {
        mergedByKey.set(key, message)
      }
      continue
    }
    fallbackItems.push(message)
  }

  const merged = [...mergedByKey.values(), ...fallbackItems]
  merged.sort((a, b) => {
    const aTime = Date.parse(String(a?.createdAt || ''))
    const bTime = Date.parse(String(b?.createdAt || ''))
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime
    }
    return String(chatMessageKey(a) || '').localeCompare(String(chatMessageKey(b) || ''))
  })

  return merged
}

const normalizePath = (value = '') =>
  String(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')

const fileNameFromPath = (path) => {
  const normalized = normalizePath(path)
  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

const parentPathFromPath = (path) => {
  const normalized = normalizePath(path)
  if (!normalized || !normalized.includes('/')) return ''
  return normalized.slice(0, normalized.lastIndexOf('/'))
}

const fileStemFromPath = (filePath) => {
  const name = fileNameFromPath(filePath)
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0) return name
  return name.slice(0, dotIndex)
}

const toRelativeImportPath = (fromFilePath, toFilePath) => {
  const fromDir = parentPathFromPath(fromFilePath)
  const fromParts = (fromDir ? fromDir.split('/') : []).filter(Boolean)
  const toParts = normalizePath(toFilePath).split('/').filter(Boolean)

  if (!toParts.length) return './'

  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift()
    toParts.shift()
  }

  const up = fromParts.map(() => '..')
  const down = toParts
  const raw = [...up, ...down].join('/')
  if (!raw) return './'
  if (raw.startsWith('.')) return raw
  return `./${raw}`
}

const buildTreeRows = (folders, files) => {
  const root = { path: '', name: '', folders: new Map(), files: [] }

  const ensureNode = (folderPath) => {
    const normalized = normalizePath(folderPath)
    if (!normalized) return root

    const parts = normalized.split('/')
    let current = root
    let cumulative = ''
    for (const part of parts) {
      cumulative = cumulative ? `${cumulative}/${part}` : part
      if (!current.folders.has(part)) {
        current.folders.set(part, {
          path: cumulative,
          name: part,
          folders: new Map(),
          files: [],
        })
      }
      current = current.folders.get(part)
    }

    return current
  }

  for (const folderPath of folders) {
    ensureNode(folderPath)
  }

  for (const file of files) {
    const filePath = normalizePath(file.path || file.name)
    const folderNode = ensureNode(parentPathFromPath(filePath))
    folderNode.files.push({
      ...file,
      path: filePath,
      name: fileNameFromPath(filePath),
    })
  }

  const rows = []
  const walk = (node, depth) => {
    const folderChildren = Array.from(node.folders.values()).sort((a, b) => a.name.localeCompare(b.name))
    for (const folder of folderChildren) {
      rows.push({ type: 'folder', depth, path: folder.path, name: folder.name })
      walk(folder, depth + 1)
    }

    const fileChildren = [...node.files].sort((a, b) => a.path.localeCompare(b.path))
    for (const file of fileChildren) {
      rows.push({ type: 'file', depth, file })
    }
  }

  walk(root, 0)
  return rows
}

const languageForFile = (fileName, fallback) => {
  const normalizedFileName = String(fileName || '').trim().toLowerCase()
  if (normalizedFileName === '.gitignore' || normalizedFileName.endsWith('.gitignore')) return 'plaintext'
  if (normalizedFileName === '.gitattributes') return 'plaintext'
  if (normalizedFileName === '.editorconfig') return 'plaintext'
  if (normalizedFileName === '.npmrc' || normalizedFileName === '.nvmrc' || normalizedFileName === '.yarnrc') return 'plaintext'
  if (normalizedFileName === '.prettierignore' || normalizedFileName === '.eslintignore' || normalizedFileName === '.dockerignore') return 'plaintext'
  if (normalizedFileName === '.prettierrc' || normalizedFileName === '.eslintrc') return 'json'
  if (normalizedFileName.endsWith('.eslintrc.json') || normalizedFileName.endsWith('.prettierrc.json')) return 'json'
  if (normalizedFileName.endsWith('.eslintrc.js') || normalizedFileName.endsWith('.prettierrc.js')) return 'javascript'
  if (normalizedFileName.endsWith('.eslintrc.cjs') || normalizedFileName.endsWith('.prettierrc.cjs')) return 'javascript'
  if (normalizedFileName === '.env' || normalizedFileName.startsWith('.env.')) return 'shell'
  if (normalizedFileName === 'dockerfile') return 'dockerfile'

  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'editorconfig' || ext === 'gitattributes') return 'plaintext'
  if (ext === 'js') return 'javascript'
  if (ext === 'jsx') return 'javascript'
  if (ext === 'ts') return 'typescript'
  if (ext === 'tsx') return 'typescript'
  if (ext === 'html') return 'html'
  if (ext === 'vue') return 'html'
  if (ext === 'css') return 'css'
  if (ext === 'json') return 'jsonc'
  if (ext === 'md') return 'markdown'
  if (ext === 'py') return 'python'
  return fallback || 'javascript'
}

const isRunnablePath = (path = '') => {
  const lower = String(path || '').toLowerCase()
  return (
    lower.endsWith('.js') ||
    lower.endsWith('.py') ||
    lower.endsWith('.cpp') ||
    lower.endsWith('.cc') ||
    lower.endsWith('.cxx') ||
    lower.endsWith('.java') ||
    lower.endsWith('.ts')
  )
}

const runtimeForPath = (path = '') => {
  const lower = String(path || '').toLowerCase()
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.ts')) return 'typescript'
  return null
}

const normalizePracticeLanguage = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'c++') return 'cpp'
  if (normalized === 'js') return 'javascript'
  if (normalized === 'ts') return 'typescript'
  return normalized
}

const runtimeMatchesPracticeLanguage = (projectLanguage, filePath) => {
  const expected = normalizePracticeLanguage(projectLanguage)
  const actual = runtimeForPath(filePath)
  return Boolean(expected && actual && expected === actual)
}

const isImagePath = (path = '') => /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(String(path || ''))
const isSvgPath = (path = '') => /\.svg$/i.test(String(path || ''))

const normalizeProjectPayload = (project, userId) => {
  if (!project) return null

  const resolvedRole =
    project.role ||
    (project.ownerId && userId && project.ownerId === userId ? 'owner' : 'collaborator')

  const resolvedCanEdit =
    typeof project.canEdit === 'boolean' ? project.canEdit : resolvedRole === 'owner' || resolvedRole === 'collaborator'

  return {
    ...project,
    role: resolvedRole,
    canEdit: resolvedCanEdit,
    templateId: project.templateId || 'react-vite',
    templateVariantId: project.templateVariantId || null,
    files: Array.isArray(project.files) ? project.files : [],
    folders: Array.isArray(project.folders) ? project.folders : [],
    chat: Array.isArray(project.chat) ? project.chat : [],
  }
}

const prettyActivityType = (activityType = '') =>
  String(activityType || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())

const describeActivity = (entry) => {
  const type = String(entry?.activityType || '').toLowerCase()
  const data = entry?.activityData || {}

  const path = normalizePath(data.path || data.filePath || '')
  const oldPath = normalizePath(data.oldPath || '')
  const newPath = normalizePath(data.newPath || '')
  const role = String(data.role || '').trim()
  const code = String(data.code || '').trim()
  const runtime = String(data.runtime || '').trim().toUpperCase()

  if (type === 'file_created') return `Created file ${path || data.name || 'Unknown'}`
  if (type === 'file_deleted') return `Deleted file ${path || data.name || 'Unknown'}`
  if (type === 'file_renamed') {
    if (oldPath && newPath) return `Renamed file ${oldPath} → ${newPath}`
    if (newPath) return `Renamed file to ${newPath}`
    return 'Renamed file'
  }

  if (type === 'folder_created') return `Created folder ${path || 'Unknown'}`
  if (type === 'folder_deleted') return `Deleted folder ${path || 'Unknown'}`
  if (type === 'folder_renamed') {
    if (oldPath && newPath) return `Renamed folder ${oldPath} → ${newPath}`
    if (newPath) return `Renamed folder to ${newPath}`
    return 'Renamed folder'
  }

  if (type === 'member_joined') return role ? `Member joined as ${role}` : 'Member joined'
  if (type === 'member_removed') {
    const removedUserName = String(data.removedUserName || '').trim()
    return removedUserName ? `Removed access for ${removedUserName}` : 'Removed member access'
  }
  if (type === 'invite_created') return code ? `Invite created (${code})` : 'Invite created'

  if (type === 'execution_queued') {
    if (path && runtime) return `Execution queued for ${path} (${runtime})`
    return 'Execution queued'
  }
  if (type === 'execution_completed') {
    if (path && runtime) return `Execution completed for ${path} (${runtime})`
    return 'Execution completed'
  }
  if (type === 'execution_failed') {
    if (path && runtime) return `Execution failed for ${path} (${runtime})`
    return 'Execution failed'
  }

  return prettyActivityType(type)
}

const ProjectPage = () => {
  const { token, user, getAuthToken } = useAuth()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [files, setFiles] = useState([])
  const [folders, setFolders] = useState([])
  const [selectedFileId, setSelectedFileId] = useState(null)
  const [selectedFolderPath, setSelectedFolderPath] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatSearch, setChatSearch] = useState('')
  const [chat, setChat] = useState([])
  const [remoteCursors, setRemoteCursors] = useState({})
  const [inviteCode, setInviteCode] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteRole, setInviteRole] = useState('collaborator')
  const [activities, setActivities] = useState([])
  const [members, setMembers] = useState([])
  const [showMembersPanel, setShowMembersPanel] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState('')
  const [_RUN_RESULT, setRunResult] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runStatus, setRunStatus] = useState('idle')
  const [consoleOutput, setConsoleOutput] = useState('')
  const [practiceStdin, setPracticeStdin] = useState('')
  const [error, setError] = useState('')
  const [_LAST_SELECTED_FILE_ID, setLastSelectedFileId] = useState(null)
  const [isCreatingPracticeFile, setIsCreatingPracticeFile] = useState(false)
  const [practiceFileName, setPracticeFileName] = useState('')
  const [isRenamingPracticeFile, setIsRenamingPracticeFile] = useState(false)
  const [practiceRenameValue, setPracticeRenameValue] = useState('')
  const [pendingPracticeSelectPath, setPendingPracticeSelectPath] = useState('')
  const [showTerminalShareConfirm, setShowTerminalShareConfirm] = useState(false)
  const [isUploadingAsset, setIsUploadingAsset] = useState(false)
  const [runtimeHealth, setRuntimeHealth] = useState(null)
  const [isProjectLoading, setIsProjectLoading] = useState(true)
  const [isOpeningLivePreview, setIsOpeningLivePreview] = useState(false)
  const [templateCatalog, setTemplateCatalog] = useState([])
  const [isAiChatGenerating, setIsAiChatGenerating] = useState(false)
  const monacoConfiguredRef = useRef(false)
  const monacoRef = useRef(null)
  const editorRef = useRef(null)
  const practiceFileInputRef = useRef(null)
  const practiceFileInputPrimedRef = useRef(false)
  const editorFocusedRef = useRef(false)
  const selectedFileIdRef = useRef(null)
  const typingGuardUntilRef = useRef(0)
  const latestLocalEditAtRef = useRef(new Map())
  const latestLocalEditVersionRef = useRef(new Map())
  const collabLastIssueAtRef = useRef(new Map())
  const disconnectWarnTimerRef = useRef(null)
  const latestProjectIdRef = useRef(projectId)
  const latestTokenRef = useRef(token)
  const ghostSuggestionTextRef = useRef('')
  const ghostSuggestionRangeRef = useRef(null)
  const ghostSuggestionFileIdRef = useRef('')
  const ghostRequestSeqRef = useRef(0)
  const ghostDebounceTimerRef = useRef(null)
  const ghostInlineProviderDisposeRef = useRef(null)
  const ghostEditorActionDisposablesRef = useRef([])
  const debugHoverWidgetRef = useRef(null)
  const debugHoverDisposablesRef = useRef([])
  const debugHoverHideTimerRef = useRef(null)
  const snippetTemplateIdRef = useRef('')
  const snippetProjectTypeRef = useRef('')
  const snippetActiveFilePathRef = useRef('')
  const projectFilePathSetRef = useRef(new Set())
  const dependencyNameSetRef = useRef(new Set(['react', 'react-dom']))
  const selectedFilePathForCodeActionsRef = useRef('')

  useEffect(() => {
    latestProjectIdRef.current = projectId
    latestTokenRef.current = token
  }, [projectId, token])

  useEffect(() => {
    snippetTemplateIdRef.current = String(project?.templateId || '').trim()
    snippetProjectTypeRef.current = String(project?.projectType || '').trim().toLowerCase()
    const activeFile = files.find((file) => file.id === selectedFileId)
    snippetActiveFilePathRef.current = normalizePath(activeFile?.path || activeFile?.name || '')
  }, [project?.templateId, project?.projectType, files, selectedFileId])

  const reportCollabIssue = useCallback((message, details) => {
    const issueKey = String(message || 'unknown')
    const nowMs = Date.now()
    const previousAt = Number(collabLastIssueAtRef.current.get(issueKey) || 0)
    if (nowMs - previousAt < 1000) return
    collabLastIssueAtRef.current.set(issueKey, nowMs)

    if (details) {
      console.warn('[collab]', message, details)
    } else {
      console.warn('[collab]', message)
    }
  }, [])

  useEffect(() => {
    latestLocalEditAtRef.current.clear()
    latestLocalEditVersionRef.current.clear()
    typingGuardUntilRef.current = 0
  }, [projectId])

  const selectedFile = useMemo(() => {
    if (!selectedFileId) return null
    return files.find((file) => file.id === selectedFileId) || null
  }, [files, selectedFileId])

  const resolvedRole = project?.role || (project?.ownerId === user?.id ? 'owner' : undefined)
  const canEdit = Boolean(
    typeof project?.canEdit === 'boolean'
      ? project.canEdit
      : resolvedRole === 'owner' || resolvedRole === 'collaborator',
  )
  const isOwner = resolvedRole === 'owner'
  const canUseAiAssistant = canEdit

  const projectSymbolIndex = useMemo(() => {
    const byFile = new Map()
    const allComponents = new Set()
    const allExports = new Set()

    for (const file of files) {
      const pathValue = normalizePath(file?.path || file?.name || '')
      if (!pathValue) continue

      const stem = fileStemFromPath(pathValue)
      const exportsList = extractExportedSymbols(String(file?.content || ''))
      for (const symbol of exportsList) {
        allExports.add(symbol)
      }

      if (isPascalCase(stem)) {
        allComponents.add(stem)
      }

      byFile.set(pathValue, {
        path: pathValue,
        stem,
        exports: exportsList,
      })
    }

    return {
      byFile,
      allComponents: Array.from(allComponents),
      allExports: Array.from(allExports),
    }
  }, [files])

  const projectGhostSummary = useMemo(() => {
    const lines = files
      .map((file) => normalizePath(file.path || file.name || ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, GHOST_PROJECT_SUMMARY_MAX_FILES)

    if (!lines.length) return ''
    return lines.join('\n')
  }, [files])

  const clearGhostSuggestion = useCallback(() => {
    ghostSuggestionTextRef.current = ''
    ghostSuggestionRangeRef.current = null
    ghostSuggestionFileIdRef.current = ''

    const editor = editorRef.current
    if (editor) {
      editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.hide', {})
    }
  }, [])

  const fetchGhostSuggestion = useCallback(async () => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !selectedFile || !projectId || !canEdit || isAiChatGenerating) {
      clearGhostSuggestion()
      return
    }

    const model = editor.getModel()
    const position = editor.getPosition()
    if (!model || !position) {
      clearGhostSuggestion()
      return
    }

    const lineContent = model.getLineContent(position.lineNumber)
    const atLineEnd = position.column === lineContent.length + 1
    if (!atLineEnd) {
      clearGhostSuggestion()
      return
    }

    const lineCount = model.getLineCount()
    const startLine = Math.max(1, position.lineNumber - GHOST_CONTEXT_WINDOW_LINES)
    const endLine = Math.min(lineCount, position.lineNumber + GHOST_CONTEXT_WINDOW_LINES)

    const contextBefore = model.getValueInRange({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })

    const contextAfter = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: endLine,
      endColumn: model.getLineMaxColumn(endLine),
    })

    const requestSeq = ghostRequestSeqRef.current + 1
    ghostRequestSeqRef.current = requestSeq
    const linePrefix = lineContent.slice(0, Math.max(0, position.column - 1))
    const lineSuffix = lineContent.slice(Math.max(0, position.column - 1))

    const buildLocalGhostFallback = () => {
      const normalizedLanguage = String(languageForFile(selectedFile?.name ?? '', project?.language) || '').toLowerCase()
      const isJsTs = normalizedLanguage === 'typescript' || normalizedLanguage === 'javascript'
      if (!isJsTs) return ''

      const trimmedPrefix = linePrefix.trim()

      const importMatch = linePrefix.match(/^\s*import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)
      if (importMatch?.[1] && selectedFile?.path) {
        const symbolName = importMatch[1]
        const candidates = files
          .map((entry) => ({
            entry,
            pathValue: normalizePath(entry?.path || entry?.name || ''),
          }))
          .filter(({ pathValue }) => {
            if (!pathValue || pathValue === normalizePath(selectedFile.path || selectedFile.name || '')) return false
            const stem = fileStemFromPath(pathValue)
            const meta = projectSymbolIndex.byFile.get(pathValue)
            const hasExportPrefix = Array.isArray(meta?.exports)
              ? meta.exports.some((item) => item === symbolName || item.startsWith(symbolName))
              : false
            return stem === symbolName || stem.startsWith(symbolName) || hasExportPrefix
          })
          .sort((a, b) => {
            const stemA = fileStemFromPath(a.pathValue)
            const stemB = fileStemFromPath(b.pathValue)
            const score = (stem) => {
              if (stem === symbolName) return 0
              if (stem.startsWith(symbolName)) return 1
              return 2
            }
            const scoreA = score(stemA)
            const scoreB = score(stemB)
            if (scoreA !== scoreB) return scoreA - scoreB
            return stemA.length - stemB.length
          })

        const candidate = candidates[0]?.entry || null
        if (candidate) {
          const candidatePath = normalizePath(candidate.path || candidate.name || '')
          const stem = fileStemFromPath(candidatePath)
          const completionTail = stem.startsWith(symbolName)
            ? stem.slice(symbolName.length)
            : ''

          const candidateWithoutExt = candidatePath.replace(/\.[^.\/]+$/, '')
          const fromPath = normalizePath(selectedFile.path || selectedFile.name || '')
          const relative = toRelativeImportPath(fromPath, candidateWithoutExt)
          return `${completionTail} from '${relative}'`
        }

        const exact = files.find((entry) => {
          const pathValue = normalizePath(entry?.path || entry?.name || '')
          if (!pathValue || pathValue === normalizePath(selectedFile.path || selectedFile.name || '')) return false
          const stem = fileStemFromPath(pathValue)
          return stem === symbolName
        })

        if (exact) {
          const candidatePath = normalizePath(exact.path || exact.name || '')
          const candidateWithoutExt = candidatePath.replace(/\.[^.\/]+$/, '')
          const fromPath = normalizePath(selectedFile.path || selectedFile.name || '')
          const relative = toRelativeImportPath(fromPath, candidateWithoutExt)
          return ` from '${relative}'`
        }
      }

      if (trimmedPrefix === 'export') {
        const inferred = String(model.getValue().match(/function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/)?.[1] || 'App')
        return ` default ${inferred}`
      }

      const jsxTagMatch = linePrefix.match(/<([A-Z][A-Za-z0-9_$]*)$/)
      if (jsxTagMatch?.[1]) {
        const typedTag = jsxTagMatch[1]
        const source = model.getValue()
        const importedComponents = new Set()

        const inferJsxPropsSnippet = (componentName) => {
          const componentFile = files.find((entry) => {
            const entryPath = normalizePath(entry?.path || entry?.name || '')
            if (!entryPath) return false
            return fileStemFromPath(entryPath) === componentName
          })

          const componentSource = String(componentFile?.content || '')
          if (!componentSource.trim()) return ' />'

          const propsTypeMatch = componentSource.match(/type\s+\w*Props\s*=\s*\{([\s\S]*?)\}/m)
          if (!propsTypeMatch?.[1]) return ' />'

          const block = propsTypeMatch[1]
          const requiredProps = []
          const propRegex = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:\s*([^\n;]+)/gm
          for (const match of block.matchAll(propRegex)) {
            const propName = String(match?.[1] || '').trim()
            const propType = String(match?.[2] || '').trim()
            const optional = /\?\s*:/.test(match?.[0] || '')
            if (!propName || optional) continue

            let sampleValue = '""'
            if (/^on[A-Z]/.test(propName)) {
              sampleValue = '{() => {}}'
            } else if (/(^is[A-Z])|active|enabled|visible/i.test(propName) || propType.includes('boolean')) {
              sampleValue = '{false}'
            } else if (/count|num|age|points|score|id/i.test(propName) || /\bnumber\b/i.test(propType)) {
              sampleValue = '{0}'
            } else {
              const unionValue = propType.match(/'([^']+)'\s*(\||$)/)
              if (unionValue?.[1]) {
                sampleValue = `'${unionValue[1]}'`
              }
            }

            requiredProps.push(`${propName}=${sampleValue}`)
            if (requiredProps.length >= 3) break
          }

          if (!requiredProps.length) return ' />'
          return ` ${requiredProps.join(' ')} />`
        }

        const defaultImportRegex = /^\s*import\s+([A-Z][A-Za-z0-9_$]*)\s+from\s+['"][^'"]+['"]/gm
        for (const match of source.matchAll(defaultImportRegex)) {
          if (match?.[1]) importedComponents.add(match[1])
        }

        const namedImportRegex = /^\s*import\s*\{([^}]+)\}\s*from\s+['"][^'"]+['"]/gm
        for (const match of source.matchAll(namedImportRegex)) {
          const namesBlock = String(match?.[1] || '')
          for (const part of namesBlock.split(',')) {
            const aliasPart = String(part || '').trim()
            if (!aliasPart) continue
            const aliasMatch = aliasPart.match(/\bas\s+([A-Z][A-Za-z0-9_$]*)$/)
            const symbol = aliasMatch?.[1] || aliasPart
            if (/^[A-Z][A-Za-z0-9_$]*$/.test(symbol)) {
              importedComponents.add(symbol)
            }
          }
        }

        const projectComponentNames = projectSymbolIndex.allComponents

        const candidates = Array.from(
          new Set([
            ...importedComponents,
            ...projectComponentNames,
            ...projectSymbolIndex.allExports.filter((item) => isPascalCase(item)),
          ]),
        )
          .filter((name) => name.startsWith(typedTag))
          .sort((a, b) => a.length - b.length)

        const best = candidates[0] || ''
        if (best && best !== typedTag) {
          return best.slice(typedTag.length)
        }
        if (best === typedTag) {
          return inferJsxPropsSnippet(best)
        }
      }

      return ''
    }

    try {
      const language = languageForFile(selectedFile?.name ?? '', project?.language)
      const payload = await apiRequest(
        `/projects/${projectId}/ai/ghost-suggestion`,
        {
          method: 'POST',
          body: JSON.stringify({
            filename: selectedFile.path || selectedFile.name || 'untitled',
            language,
            fileContent: model.getValue(),
            contextBefore,
            contextAfter,
            cursorLine: position.lineNumber,
            cursorColumn: position.column,
            linePrefix,
            lineSuffix,
            projectSummary: projectGhostSummary,
          }),
        },
        getAuthToken,
      )

      if (requestSeq !== ghostRequestSeqRef.current) return

      const suggestionText = String(payload?.suggestionText || '')
      const looksMalformedGhost =
        /suggestionText/i.test(suggestionText) ||
        /^\s*\{/.test(suggestionText) ||
        /^\s*\[/.test(suggestionText) ||
        /```/.test(suggestionText)

      if (looksMalformedGhost) {
        const fallback = buildLocalGhostFallback()
        if (!fallback) {
          clearGhostSuggestion()
          return
        }
        ghostSuggestionTextRef.current = fallback
        ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
        ghostSuggestionRangeRef.current = {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }
        editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
        return
      }

      if (!suggestionText.trim()) {
        const fallback = buildLocalGhostFallback()
        if (!fallback) {
          clearGhostSuggestion()
          return
        }
        ghostSuggestionTextRef.current = fallback
        ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
        ghostSuggestionRangeRef.current = {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }
        editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
        return
      }

      ghostSuggestionTextRef.current = suggestionText
      ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
      ghostSuggestionRangeRef.current = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }

      editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
    } catch {
      if (requestSeq !== ghostRequestSeqRef.current) return
      const fallback = buildLocalGhostFallback()
      if (!fallback) {
        clearGhostSuggestion()
        return
      }
      ghostSuggestionTextRef.current = fallback
      ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
      ghostSuggestionRangeRef.current = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }
      editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
    }
  }, [
    files,
    projectSymbolIndex,
    selectedFile,
    projectId,
    canEdit,
    isAiChatGenerating,
    project?.language,
    projectGhostSummary,
    getAuthToken,
    clearGhostSuggestion,
  ])

  const scheduleGhostSuggestion = useCallback(() => {
    if (ghostDebounceTimerRef.current) {
      window.clearTimeout(ghostDebounceTimerRef.current)
      ghostDebounceTimerRef.current = null
    }

    clearGhostSuggestion()

    if (!canEdit || isAiChatGenerating) {
      return
    }

    ghostDebounceTimerRef.current = window.setTimeout(() => {
      ghostDebounceTimerRef.current = null
      fetchGhostSuggestion()
    }, GHOST_SUGGESTION_DEBOUNCE_MS)
  }, [canEdit, isAiChatGenerating, clearGhostSuggestion, fetchGhostSuggestion])

  const bindGhostEditorActions = useCallback((editor, monaco) => {
    if (!editor || !monaco) return

    for (const disposable of ghostEditorActionDisposablesRef.current) {
      disposable?.dispose?.()
    }
    ghostEditorActionDisposablesRef.current = []

    const disposables = [
      editor.addAction({
        id: 'dc-editor.ghost.accept-all',
        label: 'Accept Ghost Suggestion',
        keybindings: [monaco.KeyCode.Tab],
        precondition: 'inlineSuggestionVisible',
        run: () => {
          editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.commit', {})
          clearGhostSuggestion()
        },
      }),
      editor.addAction({
        id: 'dc-editor.ghost.accept-next-word',
        label: 'Accept Next Word Ghost Suggestion',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow],
        precondition: 'inlineSuggestionVisible',
        run: () => {
          editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.acceptNextWord', {})
        },
      }),
      editor.addAction({
        id: 'dc-editor.ghost.dismiss',
        label: 'Dismiss Ghost Suggestion',
        keybindings: [monaco.KeyCode.Escape],
        precondition: 'inlineSuggestionVisible',
        run: () => {
          clearGhostSuggestion()
        },
      }),
    ]

    ghostEditorActionDisposablesRef.current = disposables
  }, [clearGhostSuggestion])

  const clearDebugHover = useCallback(() => {
    if (debugHoverHideTimerRef.current) {
      window.clearTimeout(debugHoverHideTimerRef.current)
      debugHoverHideTimerRef.current = null
    }

    const current = debugHoverWidgetRef.current
    if (current?.editor && current?.widget) {
      try {
        current.editor.removeContentWidget(current.widget)
      } catch {
        // Ignore editor disposal races.
      }
    }
    debugHoverWidgetRef.current = null
  }, [])

  const bindDebugHoverWidget = useCallback((editor, monaco) => {
    if (!editor || !monaco) return

    for (const disposable of debugHoverDisposablesRef.current) {
      disposable?.dispose?.()
    }
    debugHoverDisposablesRef.current = []
    clearDebugHover()

    const widgetDom = document.createElement('div')
    widgetDom.style.display = 'none'
    widgetDom.style.minWidth = '280px'
    widgetDom.style.maxWidth = '620px'
    widgetDom.style.padding = '8px 10px'
    widgetDom.style.border = '1px solid #334155'
    widgetDom.style.borderRadius = '8px'
    widgetDom.style.background = '#0f172a'
    widgetDom.style.color = '#e2e8f0'
    widgetDom.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.35)'
    widgetDom.style.zIndex = '25'
    widgetDom.style.pointerEvents = 'auto'

    const messageLine = document.createElement('div')
    messageLine.style.fontSize = '12px'
    messageLine.style.lineHeight = '1.35'
    messageLine.style.marginBottom = '8px'
    messageLine.style.whiteSpace = 'pre-wrap'
    widgetDom.appendChild(messageLine)

    const actionsRow = document.createElement('div')
    actionsRow.style.display = 'flex'
    actionsRow.style.gap = '8px'
    actionsRow.style.flexWrap = 'wrap'
    widgetDom.appendChild(actionsRow)

    const makeActionButton = (label, onClick) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.style.border = '1px solid #334155'
      button.style.borderRadius = '6px'
      button.style.background = '#111827'
      button.style.color = '#93c5fd'
      button.style.fontSize = '12px'
      button.style.padding = '3px 8px'
      button.style.cursor = 'pointer'
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick?.()
      })
      return button
    }

    let activeMarker = null
    let isHoveringDebugBox = false

    const focusActiveMarker = () => {
      if (!activeMarker) return
      const startLineNumber = Math.max(1, Number(activeMarker.startLineNumber || 1))
      const startColumn = Math.max(1, Number(activeMarker.startColumn || 1))
      const endLineNumber = Math.max(startLineNumber, Number(activeMarker.endLineNumber || startLineNumber))
      const endColumn = Math.max(startColumn, Number(activeMarker.endColumn || startColumn))

      editor.focus()
      editor.setPosition({ lineNumber: startLineNumber, column: startColumn })
      editor.setSelection({
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
      })
      editor.revealLineInCenter(startLineNumber)
    }

    const viewProblemButton = makeActionButton('View Problem', () => {
      if (!activeMarker) return
      focusActiveMarker()
      editor.trigger('debug-hover', 'editor.action.showHover', {})
    })

    const quickFixButton = makeActionButton('Quick Fix', () => {
      focusActiveMarker()
      editor.trigger('debug-hover', 'editor.action.quickFix', {})
    })

    const fixButton = makeActionButton('Fix', () => {
      focusActiveMarker()
      editor.trigger('debug-hover', 'editor.action.codeAction', {
        kind: 'quickfix',
        apply: 'first',
      })

      // If no preferred fix applied, open the quick-fix picker as fallback.
      window.setTimeout(() => {
        if (!activeMarker) return
        const model = editor.getModel()
        if (!model) return

        const stillHasMarker = monaco.editor
          .getModelMarkers({ resource: model.uri })
          .some((marker) => {
            const sameSeverity = Number(marker.severity) === Number(monaco.MarkerSeverity.Error)
            if (!sameSeverity) return false

            const overlapsLine =
              marker.startLineNumber <= activeMarker.endLineNumber && marker.endLineNumber >= activeMarker.startLineNumber
            if (!overlapsLine) return false

            const sameMessage = String(marker.message || '').trim() === String(activeMarker.message || '').trim()
            return sameMessage
          })

        if (stillHasMarker) {
          editor.trigger('debug-hover', 'editor.action.quickFix', {})
        }
      }, 100)
    })

    actionsRow.appendChild(viewProblemButton)
    actionsRow.appendChild(quickFixButton)
    actionsRow.appendChild(fixButton)

    const widget = {
      getId: () => 'dc-editor-diagnostics-hover',
      getDomNode: () => widgetDom,
      getPosition: () => {
        if (!activeMarker) return null
        const isTopRegion = Number(activeMarker.startLineNumber || 1) <= 6
        return {
          position: {
            lineNumber: Math.max(1, activeMarker.startLineNumber),
            column: Math.max(1, activeMarker.startColumn),
          },
          preference: isTopRegion
            ? [
                monaco.editor.ContentWidgetPositionPreference.BELOW,
                monaco.editor.ContentWidgetPositionPreference.ABOVE,
              ]
            : [
                monaco.editor.ContentWidgetPositionPreference.ABOVE,
                monaco.editor.ContentWidgetPositionPreference.BELOW,
              ],
        }
      },
    }

    const hideSoon = () => {
      if (debugHoverHideTimerRef.current) {
        window.clearTimeout(debugHoverHideTimerRef.current)
      }
      debugHoverHideTimerRef.current = window.setTimeout(() => {
        if (isHoveringDebugBox) return
        widgetDom.style.display = 'none'
        activeMarker = null
        try {
          editor.removeContentWidget(widget)
        } catch {
          // Ignore disposal races.
        }
      }, 900)
    }

    const keepVisible = () => {
      if (debugHoverHideTimerRef.current) {
        window.clearTimeout(debugHoverHideTimerRef.current)
        debugHoverHideTimerRef.current = null
      }
    }

    widgetDom.addEventListener('mouseenter', () => {
      isHoveringDebugBox = true
      keepVisible()
    })
    widgetDom.addEventListener('mouseleave', () => {
      isHoveringDebugBox = false
      hideSoon()
    })

    const showForMarker = (marker) => {
      if (!marker) return
      activeMarker = marker
      messageLine.textContent = String(marker.message || 'Problem detected')
      widgetDom.style.display = 'block'
      editor.addContentWidget(widget)
      editor.layoutContentWidget(widget)
      debugHoverWidgetRef.current = { editor, widget }
    }

    const onMouseMoveDisposable = editor.onMouseMove((event) => {
      const model = editor.getModel()
      const position = event?.target?.position
      if (!model || !position) {
        if (isHoveringDebugBox) return
        hideSoon()
        return
      }

      const markers = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((marker) => Number(marker.severity) === Number(monaco.MarkerSeverity.Error))

      const marker = markers.find((item) => {
        const sameLine = position.lineNumber >= item.startLineNumber && position.lineNumber <= item.endLineNumber
        if (!sameLine) return false

        if (position.lineNumber === item.startLineNumber && position.column < item.startColumn) return false
        if (position.lineNumber === item.endLineNumber && position.column > item.endColumn) return false
        return true
      })

      if (!marker) {
        if (isHoveringDebugBox) return
        hideSoon()
        return
      }

      keepVisible()
      showForMarker(marker)
    })

    const onBlurDisposable = editor.onDidBlurEditorText(() => {
      hideSoon()
    })

    debugHoverDisposablesRef.current = [onMouseMoveDisposable, onBlurDisposable]
  }, [clearDebugHover])

  useEffect(() => {
    if (ghostDebounceTimerRef.current) {
      window.clearTimeout(ghostDebounceTimerRef.current)
      ghostDebounceTimerRef.current = null
    }
    ghostRequestSeqRef.current += 1
    clearGhostSuggestion()
  }, [selectedFile?.id, isAiChatGenerating, canEdit, clearGhostSuggestion])

  useEffect(() => () => {
    if (ghostDebounceTimerRef.current) {
      window.clearTimeout(ghostDebounceTimerRef.current)
      ghostDebounceTimerRef.current = null
    }

    ghostInlineProviderDisposeRef.current?.dispose?.()
    ghostInlineProviderDisposeRef.current = null

    for (const disposable of ghostEditorActionDisposablesRef.current) {
      disposable?.dispose?.()
    }
    ghostEditorActionDisposablesRef.current = []

    for (const disposable of debugHoverDisposablesRef.current) {
      disposable?.dispose?.()
    }
    debugHoverDisposablesRef.current = []
    clearDebugHover()
  }, [])

  useEffect(() => {
    selectedFileIdRef.current = selectedFileId
  }, [selectedFileId])

  const projectFilePathSet = useMemo(() => {
    const paths = new Set()
    for (const file of files) {
      const normalized = normalizePath(file.path || file.name || '')
      if (normalized) {
        paths.add(normalized)
      }
    }
    return paths
  }, [files])

  const dependencyNameSet = useMemo(() => {
    const deps = new Set(['react', 'react-dom'])
    const packageFile = files.find((file) => normalizePath(file.path || file.name || '') === 'package.json')
    const raw = String(packageFile?.content || '')
    if (!raw.trim()) return deps

    try {
      const parsed = JSON.parse(raw)
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const entry = parsed?.[section]
        if (entry && typeof entry === 'object') {
          for (const key of Object.keys(entry)) {
            deps.add(key)
          }
        }
      }
    } catch (parseError) {
      void parseError
    }

    return deps
  }, [files])

  useEffect(() => {
    projectFilePathSetRef.current = new Set(projectFilePathSet)
    dependencyNameSetRef.current = new Set(dependencyNameSet)
    selectedFilePathForCodeActionsRef.current = normalizePath(selectedFile?.path || selectedFile?.name || '')
  }, [projectFilePathSet, dependencyNameSet, selectedFile?.path, selectedFile?.name])

  const resolveImportPath = useCallback((fromPath, specifier) => {
    const normalizedFrom = normalizePath(fromPath || '')
    const fromParts = normalizedFrom ? normalizedFrom.split('/') : []
    fromParts.pop()

    const importParts = String(specifier || '').split('/').filter(Boolean)
    for (const part of importParts) {
      if (part === '.') continue
      if (part === '..') {
        if (fromParts.length > 0) fromParts.pop()
        continue
      }
      fromParts.push(part)
    }

    return fromParts.join('/')
  }, [])

  const importExistsInProject = useCallback(
    (fromPath, specifier) => {
      const normalizedSpecifier = String(specifier || '').trim()
      if (!normalizedSpecifier) return true

      const rootAbsolute = normalizedSpecifier.startsWith('/')
      const baseTarget = rootAbsolute
        ? normalizePath(normalizedSpecifier.slice(1))
        : resolveImportPath(fromPath, normalizedSpecifier)

      if (!baseTarget) return false

      const candidatePaths = new Set([baseTarget])
      const extensionMatch = baseTarget.match(/\.(mjs|cjs|js|jsx|ts|tsx|d\.ts)$/)
      if (extensionMatch) {
        const withoutExt = baseTarget.slice(0, -extensionMatch[0].length)
        candidatePaths.add(withoutExt)

        const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']
        for (const sourceExt of sourceExts) {
          candidatePaths.add(`${withoutExt}${sourceExt}`)
          candidatePaths.add(`${withoutExt}/index${sourceExt}`)
        }
      }

      for (const candidatePath of candidatePaths) {
        if (projectFilePathSet.has(candidatePath)) return true
        if (rootAbsolute && projectFilePathSet.has(`public/${candidatePath}`)) return true
      }

      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts', '.json', '.css', '.scss', '.svg', '.png', '.jpg', '.jpeg']
      for (const ext of extensions) {
        if (projectFilePathSet.has(`${baseTarget}${ext}`)) return true
        if (projectFilePathSet.has(`${baseTarget}/index${ext}`)) return true
        if (rootAbsolute && projectFilePathSet.has(`public/${baseTarget}${ext}`)) return true
        if (rootAbsolute && projectFilePathSet.has(`public/${baseTarget}/index${ext}`)) return true
      }

      return false
    },
    [projectFilePathSet, resolveImportPath],
  )

  const validateEditorImports = useCallback(
    (editorInstance, monacoInstance) => {
      if (!editorInstance || !monacoInstance) return
      const model = editorInstance.getModel()
      if (!model) return

      const fullPath = normalizePath(selectedFile?.path || selectedFile?.name || '')
      if (fullPath.startsWith('.next/types/')) {
        monacoInstance.editor.setModelMarkers(model, 'import-validator', [])
        return
      }

      const ext = fullPath.split('.').pop()?.toLowerCase() || ''
      const supportsImportValidation = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)

      if (!supportsImportValidation) {
        monacoInstance.editor.setModelMarkers(model, 'import-validator', [])
        return
      }

      const source = model.getValue()
      const markers = []
      const regex = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g

      for (const match of source.matchAll(regex)) {
        const specifier = match[1] || match[2] || ''
        if (!specifier) continue

        const fullMatch = match[0]
        const quoteWrapped = fullMatch.match(/["'][^"']+["']/)
        const quoteText = quoteWrapped?.[0] || ''
        const quoteInnerOffset = quoteText ? fullMatch.indexOf(quoteText) + 1 : 0
        const specStartIndex = (match.index || 0) + quoteInnerOffset
        const startPos = model.getPositionAt(specStartIndex)
        const endPos = model.getPositionAt(specStartIndex + specifier.length)

        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          if (!importExistsInProject(fullPath, specifier)) {
            markers.push({
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
              message: `Cannot resolve import path "${specifier}" in project files.`,
              severity: monacoInstance.MarkerSeverity.Error,
            })
          }
          continue
        }

        if (specifier.startsWith('node:')) continue

        const packageName = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0]

        if (!dependencyNameSet.has(packageName)) {
          markers.push({
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
            message: `Package "${packageName}" is not listed in package.json dependencies.`,
            severity: monacoInstance.MarkerSeverity.Error,
          })
        }
      }

      monacoInstance.editor.setModelMarkers(model, 'import-validator', markers)
    },
    [dependencyNameSet, importExistsInProject, selectedFile?.name, selectedFile?.path],
  )

  const configureMonaco = useCallback((monaco) => {
    if (!monaco || monacoConfiguredRef.current) return

    const providerLanguageIds = [
      'javascript',
      'typescript',
      'json',
      'html',
      'css',
      'markdown',
      'plaintext',
      'python',
      'java',
      'cpp',
      'c',
      'sql',
      'vue',
      'shell',
      'yaml',
      'xml',
      'go',
      'rust',
      'php',
    ]

    const providerDisposables = providerLanguageIds.map((languageId) =>
      monaco.languages.registerInlineCompletionsProvider(languageId, {
        provideInlineCompletions: (model, position) => {
          const editor = editorRef.current
          if (!editor || model !== editor.getModel()) {
            return { items: [] }
          }

          if (String(ghostSuggestionFileIdRef.current || '') !== String(selectedFileIdRef.current || '')) {
            return { items: [] }
          }

          const range = ghostSuggestionRangeRef.current
          const text = String(ghostSuggestionTextRef.current || '')
          if (!range || !text) {
            return { items: [] }
          }

          const samePosition =
            range.startLineNumber === position.lineNumber &&
            range.startColumn === position.column &&
            range.endLineNumber === position.lineNumber &&
            range.endColumn === position.column

          if (!samePosition) {
            return { items: [] }
          }

          return {
            items: [
              {
                insertText: text,
                range,
              },
            ],
          }
        },
        freeInlineCompletions: () => {},
      }),
    )

    const snippetDisposables = SNIPPET_LANGUAGE_IDS.map((languageId) =>
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: ['!', '.', '#', '>', ':', '*', '+'],
        provideCompletionItems: (model, position) => {
          const currentLanguage = String(model?.getLanguageId?.() || languageId)
          const snippetQuery = extractSnippetQuery(model, position)
          const typedWord = String(snippetQuery.query || '').trim()

          const snippetEntries = buildSnippetEntriesForContext({
            languageId: currentLanguage,
            templateId: snippetTemplateIdRef.current,
            projectType: snippetProjectTypeRef.current,
            filePath: snippetActiveFilePathRef.current,
          })

          const normalizedFilePath = String(snippetActiveFilePathRef.current || '').toLowerCase()
          const isJsxLikeFile = normalizedFilePath.endsWith('.jsx') || normalizedFilePath.endsWith('.tsx')
          const emmetCandidateBody = buildEmmetSnippetBody(typedWord, {
            useJsxAttrs: isJsxLikeFile,
          })

          const allSnippetEntries = [...snippetEntries]
          const hasSamePrefixSnippet = allSnippetEntries.some(
            (entry) => String(entry?.prefix || '').trim() === typedWord,
          )

          if (emmetCandidateBody && !hasSamePrefixSnippet) {
            allSnippetEntries.unshift({
              prefix: typedWord,
              description: `Expand ${typedWord}`,
              detail: 'Emmet Abbreviation',
              body: emmetCandidateBody,
            })
          }

          if (!allSnippetEntries.length) {
            return { suggestions: [] }
          }

          const rankedSnippetEntries = rankSnippetEntries(allSnippetEntries, typedWord)
          const limitedSnippetEntries = rankedSnippetEntries.slice(0, 24)

          if (typedWord && limitedSnippetEntries.length === 0) {
            return { suggestions: [] }
          }

          const suggestions = limitedSnippetEntries.map((entry, index) => ({
            label: String(entry.prefix || '').trim(),
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: String(entry.body || ''),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: String(entry.description || ''),
            detail: String(entry.detail || entry.description || 'Snippet'),
            filterText: String(entry.prefix || '').trim(),
            range: snippetQuery.range,
            preselect: index === 0,
            sortText: `0-${String(index).padStart(3, '0')}`,
          }))

          return { suggestions }
        },
      }),
    )

    const fixLanguageIds = ['javascript', 'typescript']
    const codeActionDisposables = fixLanguageIds.map((languageId) =>
      monaco.languages.registerCodeActionProvider(languageId, {
        provideCodeActions: (model, range, context) => {
          const actions = []
          const providedMarkers = Array.isArray(context?.markers) ? context.markers : []
          const modelMarkers = monaco.editor
            .getModelMarkers({ resource: model.uri })
            .filter((marker) => Number(marker.severity) === Number(monaco.MarkerSeverity.Error))

          const rangeStartLine = Number(range?.startLineNumber || 1)
          const rangeEndLine = Number(range?.endLineNumber || rangeStartLine)

          const nearbyModelMarkers = modelMarkers.filter(
            (marker) => marker.startLineNumber <= rangeEndLine + 1 && marker.endLineNumber >= rangeStartLine - 1,
          )

          const markers = providedMarkers.length > 0 ? providedMarkers : nearbyModelMarkers
          const dedupeKeys = new Set()

          const pushLineReplacementAction = ({ marker, lineNumber, title, nextLine, isPreferred = false }) => {
            if (!marker || !title || typeof nextLine !== 'string') return
            const key = `${lineNumber}:${title}:${nextLine}`
            if (dedupeKeys.has(key)) return
            dedupeKeys.add(key)

            actions.push({
              title,
              kind: 'quickfix',
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    textEdit: {
                      range: {
                        startLineNumber: lineNumber,
                        startColumn: 1,
                        endLineNumber: lineNumber,
                        endColumn: model.getLineMaxColumn(lineNumber),
                      },
                      text: nextLine,
                    },
                  },
                ],
              },
              diagnostics: [marker],
              isPreferred,
            })
          }

          const normalizeReactEventName = (value = '') => {
            const normalized = String(value || '').trim().toLowerCase()
            if (!normalized.startsWith('on')) return ''

            const eventMap = {
              onclick: 'onClick',
              onchange: 'onChange',
              oninput: 'onInput',
              onsubmit: 'onSubmit',
              onkeydown: 'onKeyDown',
              onkeyup: 'onKeyUp',
              onkeypress: 'onKeyPress',
              onfocus: 'onFocus',
              onblur: 'onBlur',
              onmousedown: 'onMouseDown',
              onmouseup: 'onMouseUp',
              onmouseenter: 'onMouseEnter',
              onmouseleave: 'onMouseLeave',
              onmousemove: 'onMouseMove',
              onmouseover: 'onMouseOver',
              onmouseout: 'onMouseOut',
              ontouchstart: 'onTouchStart',
              ontouchend: 'onTouchEnd',
              ondragstart: 'onDragStart',
              ondragend: 'onDragEnd',
              oncontextmenu: 'onContextMenu',
            }

            return eventMap[normalized] || ''
          }

          const normalizeCommonJsxPropName = (value = '') => {
            const normalized = String(value || '').trim().toLowerCase()
            const propMap = {
              tabindex: 'tabIndex',
              readonly: 'readOnly',
              maxlength: 'maxLength',
              minlength: 'minLength',
              autofocus: 'autoFocus',
              autocomplete: 'autoComplete',
              spellcheck: 'spellCheck',
              contenteditable: 'contentEditable',
              srcset: 'srcSet',
              crossorigin: 'crossOrigin',
              referrerpolicy: 'referrerPolicy',
            }

            return propMap[normalized] || ''
          }

          const buildTagSyntaxRepair = (line = '') => {
            const source = String(line || '')
            if (!source.includes('<') || !source.includes('>')) return ''

            let repaired = source

            // Remove invalid punctuation attached to opening tag names: <h1.> -> <h1>
            repaired = repaired.replace(/<([A-Za-z][\w:-]*)([^\w\s/>]+)(?=[\s/>])/g, '<$1')

            // Remove invalid punctuation attached to closing tag names: </div.> -> </div>
            repaired = repaired.replace(/<\/([A-Za-z][\w:-]*)([^\w\s>]+)(?=\s*>)/g, '</$1')

            // Normalize accidental punctuation before tag end: <div..> -> <div>
            repaired = repaired.replace(/<([A-Za-z][\w:-]*)(?:\s+[^>]*)?([.]{2,})(\s*>)/g, '<$1$3')

            return repaired !== source ? repaired : ''
          }

          const toRelativeImportSpecifier = (fromFilePath, targetFilePath) => {
            const fromParts = normalizePath(fromFilePath).split('/').filter(Boolean)
            if (fromParts.length > 0) fromParts.pop()

            const targetParts = normalizePath(targetFilePath).split('/').filter(Boolean)
            let index = 0
            while (
              index < fromParts.length &&
              index < targetParts.length &&
              fromParts[index] === targetParts[index]
            ) {
              index += 1
            }

            const up = new Array(fromParts.length - index).fill('..')
            const down = targetParts.slice(index)
            const rel = [...up, ...down].join('/')
            if (!rel) return './'
            return rel.startsWith('.') ? rel : `./${rel}`
          }

          const stripSourceExtension = (value = '') => String(value || '').replace(/\.(tsx?|jsx?|mjs|cjs|d\.ts)$/i, '')

          const normalizeLooseName = (value = '') => stripSourceExtension(String(value || '')).replace(/[^a-z0-9]/gi, '').toLowerCase()

          const approximateDistance = (first = '', second = '') => {
            const a = String(first || '')
            const b = String(second || '')
            const rows = a.length + 1
            const cols = b.length + 1
            const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0))

            for (let i = 0; i < rows; i += 1) matrix[i][0] = i
            for (let j = 0; j < cols; j += 1) matrix[0][j] = j

            for (let i = 1; i < rows; i += 1) {
              for (let j = 1; j < cols; j += 1) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1
                matrix[i][j] = Math.min(
                  matrix[i - 1][j] + 1,
                  matrix[i][j - 1] + 1,
                  matrix[i - 1][j - 1] + cost,
                )
              }
            }

            return matrix[a.length][b.length]
          }

          for (const marker of markers) {
            const rawMessage = String(marker?.message || '')
            const message = String(marker?.message || '').toLowerCase()
            const lineNumber = Number(marker?.startLineNumber || range.startLineNumber || 1)
            const lineContent = model.getLineContent(Math.max(1, lineNumber))

            const unresolvedImportMatch = rawMessage.match(/Cannot resolve import path "([^"]+)"/i)
            if (unresolvedImportMatch?.[1]) {
              const currentFilePath = String(selectedFilePathForCodeActionsRef.current || '').trim()
              const badSpecifier = String(unresolvedImportMatch[1] || '').trim()
              const fromMatch = lineContent.match(/from\s+["']([^"']+)["']/)
              const dynamicMatch = lineContent.match(/import\s*\(\s*["']([^"']+)["']\s*\)/)
              const currentSpecifier = String(fromMatch?.[1] || dynamicMatch?.[1] || badSpecifier).trim()

              const badName = normalizePath(currentSpecifier).split('/').pop() || ''
              const badNameWithoutExt = stripSourceExtension(badName)
              const badNameLoose = normalizeLooseName(badName)
              const badExtMatch = badName.match(/\.([A-Za-z0-9]+)$/)
              const badExt = String(badExtMatch?.[1] || '').toLowerCase()
              const badSpecifierDir = normalizePath(currentSpecifier).split('/').slice(0, -1).join('/')
              const candidatePaths = []

              for (const pathValue of projectFilePathSetRef.current) {
                const candidateName = normalizePath(pathValue).split('/').pop() || ''
                const candidateNameWithoutExt = stripSourceExtension(candidateName)
                if (!candidateNameWithoutExt) continue

                const candidateExtMatch = candidateName.match(/\.([A-Za-z0-9]+)$/)
                const candidateExt = String(candidateExtMatch?.[1] || '').toLowerCase()
                if (badExt && candidateExt && badExt !== candidateExt) continue

                const candidateLoose = normalizeLooseName(candidateName)
                if (!candidateLoose) continue

                const exactMatch = candidateNameWithoutExt === badNameWithoutExt
                const looseMatch = candidateLoose === badNameLoose
                const partialMatch =
                  candidateLoose.includes(badNameLoose) ||
                  badNameLoose.includes(candidateLoose) ||
                  approximateDistance(candidateLoose, badNameLoose) <= 2

                if (exactMatch || looseMatch || partialMatch) {
                  const normalizedPath = normalizePath(pathValue)
                  const candidateDir = normalizedPath.split('/').slice(0, -1).join('/')
                  const sameDir = badSpecifierDir && candidateDir.endsWith(badSpecifierDir)
                  const distance = approximateDistance(candidateLoose, badNameLoose)
                  candidatePaths.push({
                    pathValue,
                    sameDir,
                    distance,
                  })
                }
              }

              if (currentFilePath && candidatePaths.length > 0) {
                const ranked = candidatePaths
                  .sort((a, b) => {
                    if (a.sameDir !== b.sameDir) return a.sameDir ? -1 : 1
                    if (a.distance !== b.distance) return a.distance - b.distance
                    return String(a.pathValue).length - String(b.pathValue).length
                  })
                  .map((candidate) => stripSourceExtension(toRelativeImportSpecifier(currentFilePath, candidate.pathValue)))
                  .filter((specifier) => specifier && specifier !== currentSpecifier)
                  .slice(0, 3)

                for (const specifier of ranked) {
                  const escaped = currentSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                  const nextLine = lineContent.replace(new RegExp(escaped, 'g'), specifier)
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: `Change import path to "${specifier}"`,
                    nextLine,
                    isPreferred: true,
                  })
                }
              }

              if (currentFilePath && candidatePaths.length === 0 && badNameWithoutExt.includes('.')) {
                const cleanedBase = badNameWithoutExt.replace(/\./g, '')
                const cleanedName = badExt ? `${cleanedBase}.${badExt}` : cleanedBase
                const cleanedSpecifier = currentSpecifier.replace(new RegExp(`${badName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), cleanedName)

                if (cleanedSpecifier && cleanedSpecifier !== currentSpecifier) {
                  const escaped = currentSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                  const nextLine = lineContent.replace(new RegExp(escaped, 'g'), cleanedSpecifier)
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: `Try cleaned import path "${cleanedSpecifier}"`,
                    nextLine,
                  })
                }
              }
            }

            const missingPackageMatch = rawMessage.match(/Package "([^"]+)" is not listed in package\.json dependencies\./i)
            if (missingPackageMatch?.[1]) {
              const packageName = String(missingPackageMatch[1] || '').trim()
              const currentFilePath = String(selectedFilePathForCodeActionsRef.current || '').trim()
              const localCandidate = Array.from(projectFilePathSetRef.current).find((pathValue) => {
                const normalized = stripSourceExtension(normalizePath(pathValue))
                return normalized.endsWith(`/${packageName}`) || normalized === packageName
              })

              if (currentFilePath && localCandidate) {
                const localSpecifier = stripSourceExtension(toRelativeImportSpecifier(currentFilePath, localCandidate))
                const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                const nextLine = lineContent.replace(new RegExp(escaped, 'g'), localSpecifier)
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: `Use local file import "${localSpecifier}"`,
                  nextLine,
                })
              }
            }

            if (message.includes("'export' expected") || message.includes('export expected')) {
              if (/export\.\s*default/.test(lineContent)) {
                const fixedLine = lineContent.replace(/export\.\s*default/g, 'export default')
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: 'Replace "export." with "export "',
                  nextLine: fixedLine,
                  isPreferred: true,
                })
              }
            }

            if (message.includes('array element destructuring pattern expected')) {
              if (/\[.*?,\s*\./.test(lineContent)) {
                const fixedLine = lineContent.replace(/,\s*\./g, ', ')
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: 'Remove invalid "." in array destructuring',
                  nextLine: fixedLine,
                  isPreferred: true,
                })
              }
            }

            if (message.includes('identifier expected') || message.includes('unexpected token')) {
              const joinAttrMatch = lineContent.match(/([A-Za-z_$][\w$]*)([^\w\s=:>{}/-]+)([A-Za-z_$][\w$]*)(\s*=)/)
              if (joinAttrMatch?.[0]) {
                const left = String(joinAttrMatch[1] || '')
                const separator = String(joinAttrMatch[2] || '')
                const right = String(joinAttrMatch[3] || '')
                const combined = `${left}${right}`
                const reactEventName = normalizeReactEventName(combined)
                const preferredIdentifier = reactEventName || combined

                const fixedLine = lineContent.replace(joinAttrMatch[0], `${preferredIdentifier}${joinAttrMatch[4]}`)
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: reactEventName
                    ? `Fix invalid event handler name to ${reactEventName}`
                    : `Remove invalid "${separator}" in identifier`,
                  nextLine: fixedLine,
                  isPreferred: true,
                })
              }

              const dotMatch = lineContent.match(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/)
              if (dotMatch?.[0] && /=/.test(lineContent)) {
                const collapsed = `${dotMatch[1]}${dotMatch[2]}`
                const reactEventName = normalizeReactEventName(collapsed)
                const replacement = reactEventName || collapsed
                const fixedLine = lineContent.replace(dotMatch[0], replacement)
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: reactEventName
                    ? `Change ${dotMatch[0]} to ${reactEventName}`
                    : `Join split identifier ${dotMatch[0]}`,
                  nextLine: fixedLine,
                  isPreferred: true,
                })
              }
            }

            const expectedClosingTag = message.match(/expected corresponding jsx closing tag for ['"]?([a-z][\w:-]*)['"]?/i)
            if (expectedClosingTag?.[1]) {
              const expectedTag = String(expectedClosingTag[1] || '').trim()
              const closingTagRegex = /<\/([A-Za-z][\w:-]*)\s*>/
              const closingMatch = lineContent.match(closingTagRegex)

              if (expectedTag && closingMatch?.[1] && closingMatch[1] !== expectedTag) {
                const fixedLine = lineContent.replace(closingTagRegex, `</${expectedTag}>`)
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: `Change closing tag to </${expectedTag}>`,
                  nextLine: fixedLine,
                  isPreferred: true,
                })
              }
            }

            const missingClosingTag = message.match(/jsx element ['"]?([a-z][\w:-]*)['"]? has no corresponding closing tag/i)
            if (missingClosingTag?.[1]) {
              const openTag = String(missingClosingTag[1] || '').trim()
              if (openTag) {
                const openTagRegex = new RegExp(`<${openTag}(\\s[^>]*)?>`, 'i')
                const openMatch = lineContent.match(openTagRegex)
                if (openMatch?.[0] && !/\/\s*>\s*$/.test(openMatch[0])) {
                  const fixedLine = lineContent.replace(openTagRegex, (matchedTag) => matchedTag.replace(/>\s*$/, ' />'))
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: `Convert <${openTag}> to self-closing`,
                    nextLine: fixedLine,
                  })
                }

                if (/<[A-Za-z][\w:-]*\b[^>]*\bclass\s*=/.test(lineContent)) {
                  const fixedLine = lineContent.replace(/\bclass\s*=/g, 'className=')
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: 'Use className instead of class in JSX',
                    nextLine: fixedLine,
                    isPreferred: true,
                  })
                }

                if (/<label\b[^>]*\bfor\s*=/.test(lineContent)) {
                  const fixedLine = lineContent.replace(/\bfor\s*=/g, 'htmlFor=')
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: 'Use htmlFor instead of for in JSX',
                    nextLine: fixedLine,
                    isPreferred: true,
                  })
                }

                const doublePunctuationMatch = lineContent.match(/([A-Za-z_$][\w$]*)([.]{2,}|[,;:]{2,})([A-Za-z_$][\w$]*)/)
                if (doublePunctuationMatch?.[0]) {
                  const repaired = `${doublePunctuationMatch[1]}.${doublePunctuationMatch[3]}`
                  const fixedLine = lineContent.replace(doublePunctuationMatch[0], repaired)
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: 'Remove invalid repeated punctuation in identifier',
                    nextLine: fixedLine,
                  })
                }

                if (/<[A-Za-z][\w:-]*\b[^>]*\b([A-Za-z][\w-]*)\s*=/.test(lineContent)) {
                  const attrMatch = lineContent.match(/\b([A-Za-z][\w-]*)\s*=/)
                  const rawProp = String(attrMatch?.[1] || '').trim()
                  const normalizedProp = normalizeCommonJsxPropName(rawProp)
                  if (rawProp && normalizedProp && rawProp !== normalizedProp) {
                    const fixedLine = lineContent.replace(new RegExp(`\\b${rawProp}\\s*=`), `${normalizedProp}=`)
                    pushLineReplacementAction({
                      marker,
                      lineNumber,
                      title: `Use ${normalizedProp} instead of ${rawProp} in JSX`,
                      nextLine: fixedLine,
                    })
                  }
                }
              }

              if (message.includes('expression expected') || message.includes('declaration or statement expected')) {
                const trimmed = lineContent.trimEnd()

                if (/\}\s*\}\s*$/.test(trimmed)) {
                  const fixedLine = lineContent.replace(/\}\s*\}\s*$/, '}')
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: 'Remove extra closing brace',
                    nextLine: fixedLine,
                  })
                }

                if (/\)\s*\)\s*$/.test(trimmed)) {
                  const fixedLine = lineContent.replace(/\)\s*\)\s*$/, ')')
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: 'Remove extra closing parenthesis',
                    nextLine: fixedLine,
                  })
                }

                const operatorPairs = [
                  { pattern: /===\s*=/, replacement: '===', title: 'Remove extra "=" after ===' },
                  { pattern: /!==\s*=/, replacement: '!==', title: 'Remove extra "=" after !==' },
                  { pattern: /&&\s*&&/, replacement: '&&', title: 'Remove duplicate && operator' },
                  { pattern: /\|\|\s*\|\|/, replacement: '||', title: 'Remove duplicate || operator' },
                ]

                for (const operatorRule of operatorPairs) {
                  if (!operatorRule.pattern.test(lineContent)) continue
                  const fixedLine = lineContent.replace(operatorRule.pattern, operatorRule.replacement)
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: operatorRule.title,
                    nextLine: fixedLine,
                  })
                }

                const hasMalformedArrayComma = /\[[^\]]*,\s*,[^\]]*\]/.test(lineContent) || /\[[^\]]*,\s*,\s*\]/.test(lineContent)
                if (hasMalformedArrayComma) {
                  const fixedLine = lineContent
                    .replace(/,\s*,\s*\]/g, ']')
                    .replace(/,\s*,/g, ', ')
                  if (fixedLine !== lineContent) {
                    pushLineReplacementAction({
                      marker,
                      lineNumber,
                      title: 'Remove invalid extra comma in array literal',
                      nextLine: fixedLine,
                    })
                  }
                }

                const hasDuplicateSemicolons = /;{2,}/.test(lineContent)
                const isForLoopControl = /for\s*\([^)]*;;[^)]*\)/.test(lineContent)
                if (hasDuplicateSemicolons && !isForLoopControl) {
                  const fixedLine = lineContent.replace(/;{2,}/g, ';')
                  if (fixedLine !== lineContent) {
                    pushLineReplacementAction({
                      marker,
                      lineNumber,
                      title: 'Remove duplicate semicolon',
                      nextLine: fixedLine,
                    })
                  }
                }
              }

              if (message.includes("',' expected") || message.includes('expected ,')) {
                const trimmed = lineContent.trimEnd()
                const nextLineNumber = Math.min(model.getLineCount(), lineNumber + 1)
                const nextLine = String(model.getLineContent(nextLineNumber) || '')
                const nextTrimmed = nextLine.trim()

                const looksLikeObjectProperty = /^\s*[A-Za-z_$][\w$]*\s*:\s*.+$/.test(trimmed)
                const shouldAppendComma =
                  looksLikeObjectProperty &&
                  !/[,{[(]\s*$/.test(trimmed) &&
                  !/,\s*$/.test(trimmed) &&
                  /^([A-Za-z_$][\w$]*|['"][^'"]+['"])\s*:/.test(nextTrimmed)

                if (shouldAppendComma) {
                  const fixedLine = `${trimmed},`
                  pushLineReplacementAction({
                    marker,
                    lineNumber,
                    title: 'Insert missing comma between object properties',
                    nextLine: fixedLine,
                    isPreferred: true,
                  })
                }
              }

              const repairedTagLine = buildTagSyntaxRepair(lineContent)
              if (repairedTagLine) {
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: 'Fix malformed JSX/HTML tag syntax',
                  nextLine: repairedTagLine,
                  isPreferred: true,
                })
              }
            }

            // Fallback tag-syntax repair for parser errors not covered by message filters.
            if (message.includes('expected') || message.includes('unterminated') || message.includes('invalid')) {
              const repairedTagLine = buildTagSyntaxRepair(lineContent)
              if (repairedTagLine) {
                pushLineReplacementAction({
                  marker,
                  lineNumber,
                  title: 'Repair invalid tag characters',
                  nextLine: repairedTagLine,
                })
              }
            }
          }

          return {
            actions,
            dispose: () => {},
          }
        },
      }),
    )

    ghostInlineProviderDisposeRef.current = {
      dispose: () => {
        for (const disposable of providerDisposables) {
          disposable?.dispose?.()
        }
        for (const disposable of snippetDisposables) {
          disposable?.dispose?.()
        }
        for (const disposable of codeActionDisposables) {
          disposable?.dispose?.()
        }
      },
    }

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: false,
    })

    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: false,
    })

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ES2022,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
    })

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ES2022,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowJs: true,
      checkJs: false,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
    })

    monacoConfiguredRef.current = true
  }, [])

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return
    validateEditorImports(editorRef.current, monacoRef.current)
  }, [validateEditorImports, selectedFile?.id, files])

  useEffect(() => {
    if (!selectedFile?.id || !projectId) return
    const selectedPath = selectedFile.path || selectedFile.name || ''
    const isSvgFile = isSvgPath(selectedPath)
    if (!selectedFile.blobUrl && !isSvgFile) return
    if (selectedFile.isBinary && !isSvgFile) return
    if (typeof selectedFile.content === 'string' && selectedFile.content.length > 0) return

    let cancelled = false

    const loadSelectedFileContent = async () => {
      try {
        const data = await apiRequest(`/projects/${projectId}/files/${selectedFile.id}/content`, {}, getAuthToken)
        if (cancelled) return
        setFiles((prev) =>
          prev.map((file) => (file.id === selectedFile.id ? { ...file, content: data.content ?? '' } : file)),
        )
      } catch (loadContentError) {
        void loadContentError
      }
    }

    loadSelectedFileContent()

    return () => {
      cancelled = true
    }
  }, [selectedFile?.id, selectedFile?.blobUrl, selectedFile?.path, selectedFile?.name, selectedFile?.content, selectedFile?.isBinary, projectId, getAuthToken])

  // Track the last non-null file selection to prevent losing context during operations
  useEffect(() => {
    if (selectedFileId) {
      setLastSelectedFileId(selectedFileId)
    }
  }, [selectedFileId])

  const selectedFileIsImage = Boolean(
    selectedFile && (selectedFile.isBinary || isImagePath(selectedFile.path || selectedFile.name || '')),
  )
  const selectedFilePreviewSrc = useMemo(() => {
    if (!selectedFile) return ''

    const filePath = selectedFile.path || selectedFile.name || ''
    if (isSvgPath(filePath) && typeof selectedFile.content === 'string' && selectedFile.content.trim().length > 0) {
      const rawContent = selectedFile.content.trim()
      if (rawContent.startsWith('data:image/')) {
        return rawContent
      }
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(selectedFile.content)}`
    }

    if (selectedFile.blobUrl) return selectedFile.blobUrl

    return ''
  }, [selectedFile])
  const _TREE_ROWS = useMemo(() => buildTreeRows(folders, files), [folders, files])
  const filteredChat = useMemo(() => {
    const query = String(chatSearch || '').trim().toLowerCase()
    if (!query) return chat
    return chat.filter((message) => {
      const text = String(message?.message || '').toLowerCase()
      const name = String(message?.userName || '').toLowerCase()
      return text.includes(query) || name.includes(query)
    })
  }, [chat, chatSearch])

  const formatLastSeen = (value) => {
    if (!value) return 'Never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString()
  }

  useEffect(() => {
    if (!token) return

    const loadProject = async () => {
      setIsProjectLoading(true)
      try {
        const data = await apiRequest(`/projects/${projectId}`, {}, getAuthToken)
        const normalizedProject = normalizeProjectPayload(data.project, user?.id)
        setProject(normalizedProject)
        setFiles(normalizedProject?.files || [])
        setFolders(normalizedProject?.folders || [])
        setChat(normalizedProject?.chat || [])
        setSelectedFileId((prev) => prev ?? normalizedProject?.files?.[0]?.id ?? null)
        setError('')
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsProjectLoading(false)
      }
    }

    loadProject()
  }, [projectId, token, getAuthToken, user?.id])

  useEffect(() => {
    let cancelled = false

    const loadTemplateCatalog = async () => {
      try {
        const data = await apiRequest('/templates')
        if (!cancelled) {
          setTemplateCatalog(Array.isArray(data.templates) ? data.templates : [])
        }
      } catch {
        if (!cancelled) {
          setTemplateCatalog([])
        }
      }
    }

    loadTemplateCatalog()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadHealth = async () => {
      try {
        const data = await apiRequest('/health')
        if (cancelled) return
        setRuntimeHealth(data)
        setError((prev) =>
          String(prev || '').includes('Cannot reach backend server')
            ? ''
            : prev,
        )
      } catch (healthError) {
        void healthError
      }
    }

    loadHealth()
    const timerId = setInterval(loadHealth, 12000)

    return () => {
      cancelled = true
      clearInterval(timerId)
    }
  }, [projectId])

  const cloudinaryOn = Boolean(runtimeHealth?.storage?.cloudinary)
  const postgresOn = Boolean(runtimeHealth?.storage?.postgres)
  const queueOn = Boolean(runtimeHealth?.queue?.enabled)
  const redisOn = Boolean(runtimeHealth?.queue?.redis)

  useEffect(() => {
    if (!token || !projectId) return

    let cancelled = false

    const loadActivity = async () => {
      try {
        const data = await apiRequest(`/projects/${projectId}/activity?limit=100`, {}, getAuthToken)
        if (!cancelled) {
          const normalized = Array.isArray(data.activities) ? data.activities : []
          const nonChatActivities = normalized.filter(
            (entry) => String(entry?.activityType || '').toLowerCase() !== 'chat_message_sent',
          )
          setActivities(nonChatActivities.slice(0, 25))
        }
      } catch (activityError) {
        void activityError
      }
    }

    loadActivity()
    const timerId = setInterval(loadActivity, 8000)

    return () => {
      cancelled = true
      clearInterval(timerId)
    }
  }, [projectId, token, getAuthToken])

  useEffect(() => {
    if (!token || !projectId || !isOwner || !showMembersPanel) return

    let cancelled = false

    const loadMembers = async () => {
      if (!cancelled) {
        setMembersLoading(true)
      }

      try {
        const data = await apiRequest(`/projects/${projectId}/members`, {}, getAuthToken)
        if (!cancelled) {
          setMembers(data.members || [])
        }
      } catch (membersError) {
        if (!cancelled) {
          setError(membersError.message || 'Failed to load members')
        }
      } finally {
        if (!cancelled) {
          setMembersLoading(false)
        }
      }
    }

    loadMembers()
    const timerId = setInterval(loadMembers, 6000)

    return () => {
      cancelled = true
      clearInterval(timerId)
    }
  }, [projectId, token, isOwner, showMembersPanel, getAuthToken])

  useEffect(() => {
    if (!pendingPracticeSelectPath) return
    const target = pendingPracticeSelectPath.toLowerCase()
    const created = files.find((file) => normalizePath(file.path || file.name).toLowerCase() === target)
    if (!created) return

    setSelectedFileId(created.id)
    setPendingPracticeSelectPath('')
  }, [files, pendingPracticeSelectPath])

  useEffect(() => {
    if (!isCreatingPracticeFile) {
      practiceFileInputPrimedRef.current = false
      return
    }

    if (practiceFileInputPrimedRef.current) return
    const input = practiceFileInputRef.current
    if (!input) return

    const fileName = String(practiceFileName || '')
    if (!fileName.trim()) return
    const dotIndex = fileName.lastIndexOf('.')
    const selectionEnd = dotIndex > 0 ? dotIndex : fileName.length

    practiceFileInputPrimedRef.current = true
    setTimeout(() => {
      try {
        input.focus()
        input.setSelectionRange(0, selectionEnd)
      } catch (selectionError) {
        void selectionError
      }
    }, 0)
  }, [isCreatingPracticeFile, practiceFileName])

  useEffect(() => {
    if (!token) return

    const socket = getSocket(token)
    if (!socket || !projectId) return

    const joinProjectRoom = () => {
      socket.emit('project:join', { projectId })
    }

    const onSnapshot = (snapshot) => {
      if (snapshot.id !== projectId) return
      const normalizedSnapshot = normalizeProjectPayload(snapshot, user?.id)
      setProject(normalizedSnapshot)
      setFiles((prev) => {
        const now = Date.now()
        const typingGuardActive = now < Number(typingGuardUntilRef.current || 0)
        const previousById = new Map((prev || []).map((file) => [file.id, file]))
        return (normalizedSnapshot?.files || []).map((incomingFile) => {
          const previousFile = previousById.get(incomingFile.id)
          if (!previousFile || incomingFile.isBinary) return incomingFile

          const previousUpdatedAtMs = Date.parse(String(previousFile.updatedAt || ''))
          const incomingUpdatedAtMs = Date.parse(String(incomingFile.updatedAt || ''))
          if (
            Number.isFinite(previousUpdatedAtMs) &&
            Number.isFinite(incomingUpdatedAtMs) &&
            incomingUpdatedAtMs < previousUpdatedAtMs
          ) {
            return {
              ...incomingFile,
              content: previousFile.content ?? incomingFile.content,
              updatedAt: previousFile.updatedAt || incomingFile.updatedAt,
            }
          }

          const shouldProtectWhileTyping = typingGuardActive && selectedFileIdRef.current === incomingFile.id

          if (shouldProtectWhileTyping) {
            return {
              ...incomingFile,
              content: previousFile.content ?? incomingFile.content,
              updatedAt: previousFile.updatedAt || incomingFile.updatedAt,
            }
          }

          return incomingFile
        })
      })
      setFolders(normalizedSnapshot?.folders || [])
      setChat((prev) => mergeChatMessages(normalizedSnapshot?.chat, prev))
      // Maintain current file selection if it still exists, otherwise keep the selection
      setSelectedFileId((prev) => {
        // If something is currently selected, keep it
        if (prev) {
          // Check if the selected file still exists in the updated files
          const stillExists = (normalizedSnapshot?.files || []).some((f) => f.id === prev)
          if (stillExists) return prev
          // If it was deleted, keep null to trigger selection of first file
          return null
        }
        // If nothing is selected, select the first file
        return normalizedSnapshot?.files?.[0]?.id ?? null
      })
      setError('')
    }

    const onCreated = (file) => {
      setFiles((prev) => [...prev, file])
      setSelectedFileId((prev) => prev ?? file.id)
    }

    const onRenamed = (payload) => {
      setFiles((prev) => prev.map((file) => (file.id === payload.fileId ? { ...file, ...payload } : file)))
    }

    const onDeleted = ({ fileId }) => {
      setFiles((prev) => prev.filter((file) => file.id !== fileId))
      setSelectedFileId((prev) => (prev === fileId ? null : prev))
    }

    const onUpdated = ({ fileId, content, updatedAt, clientUpdatedAt, userId: eventUserId }) => {
      const incomingUpdatedAtMs = Date.parse(String(updatedAt || ''))
      const incomingClientVersion = Number(clientUpdatedAt)

      setFiles((prev) =>
        prev.map((file) =>
          file.id === fileId
            ? (() => {
                const previousUpdatedAtMs = Date.parse(String(file.updatedAt || ''))
                const latestLocalVersion = Number(latestLocalEditVersionRef.current.get(fileId) || 0)
                const isOwnEcho = String(eventUserId || '') === String(user?.id || '')

                if (
                  Number.isFinite(previousUpdatedAtMs) &&
                  Number.isFinite(incomingUpdatedAtMs) &&
                  incomingUpdatedAtMs < previousUpdatedAtMs
                ) {
                  return file
                }

                if (
                  isOwnEcho &&
                  Number.isFinite(incomingClientVersion) &&
                  latestLocalVersion > 0 &&
                  incomingClientVersion <= latestLocalVersion
                ) {
                  return file
                }

                return {
                  ...file,
                  content,
                  updatedAt,
                }
              })()
            : file,
        ),
      )
    }

    const onCursorUpdated = ({ fileId, position, userId, userName, avatarUrl, isTyping }) => {
      if (String(userId || '') === String(user?.id || '')) return
      if (!isTyping) return

      setRemoteCursors((prev) => ({
        ...prev,
        [userId]: {
          userName,
          fileId,
          position,
          avatarUrl: String(avatarUrl || '').trim(),
          color: pickCursorColor(userId),
          lastActiveAt: Date.now(),
          isTyping: true,
        },
      }))
    }

    const onChatMessage = (message) => {
      setChat((prev) => {
        if (message?.clientMessageId) {
          const index = prev.findIndex((entry) => entry.clientMessageId === message.clientMessageId)
          if (index >= 0) {
            const next = [...prev]
            next[index] = message
            return next
          }
        }
        return [...prev, message]
      })
    }

    const onSocketError = (payload) => {
      setError(payload?.message || 'Operation failed')
    }

    const onDisconnect = (reason) => {
      const normalizedReason = String(reason || '').trim().toLowerCase()
      if (normalizedReason === 'io client disconnect') return

      if (disconnectWarnTimerRef.current) {
        window.clearTimeout(disconnectWarnTimerRef.current)
      }

      disconnectWarnTimerRef.current = window.setTimeout(() => {
        if (socket.connected) return
        reportCollabIssue(`Realtime disconnected: ${String(reason || 'unknown_reason')}`)
      }, 1800)
    }

    const onProjectDeleted = ({ projectId: deletedProjectId }) => {
      if (deletedProjectId !== projectId) return
      navigate('/dashboard')
    }

    const onProjectAccessRemoved = ({ projectId: removedProjectId, message }) => {
      if (removedProjectId !== projectId) return
      setError(message || 'Your access to this project has been removed.')
      navigate('/dashboard')
    }

    const onConnectError = async (connectError) => {
      const message = connectError?.message || ''
      if (!/unauthorized/i.test(message)) return

      const freshToken = await getAuthToken(true)
      if (!freshToken) {
        setError('Session expired. Please login again.')
        return
      }

      const refreshedSocket = getSocket(freshToken)
      refreshedSocket?.connect()
    }

    const onConnect = () => {
      if (disconnectWarnTimerRef.current) {
        window.clearTimeout(disconnectWarnTimerRef.current)
        disconnectWarnTimerRef.current = null
      }
      joinProjectRoom()
    }

    if (socket.connected) {
      onConnect()
    }

    socket.on('connect', onConnect)
    socket.on('connect_error', onConnectError)
    socket.on('disconnect', onDisconnect)
    socket.on('project:snapshot', onSnapshot)
    socket.on('file:created', onCreated)
    socket.on('file:renamed', onRenamed)
    socket.on('file:deleted', onDeleted)
    socket.on('file:updated', onUpdated)
    socket.on('cursor:updated', onCursorUpdated)
    socket.on('chat:message', onChatMessage)
    socket.on('error:event', onSocketError)
    socket.on('project:deleted', onProjectDeleted)
    socket.on('project:access-removed', onProjectAccessRemoved)

    return () => {
      if (disconnectWarnTimerRef.current) {
        window.clearTimeout(disconnectWarnTimerRef.current)
        disconnectWarnTimerRef.current = null
      }
      socket.off('connect', onConnect)
      socket.off('connect_error', onConnectError)
      socket.off('disconnect', onDisconnect)
      socket.off('project:snapshot', onSnapshot)
      socket.off('file:created', onCreated)
      socket.off('file:renamed', onRenamed)
      socket.off('file:deleted', onDeleted)
      socket.off('file:updated', onUpdated)
      socket.off('cursor:updated', onCursorUpdated)
      socket.off('chat:message', onChatMessage)
      socket.off('error:event', onSocketError)
      socket.off('project:deleted', onProjectDeleted)
      socket.off('project:access-removed', onProjectAccessRemoved)
    }
  }, [projectId, token, getAuthToken, navigate, user?.id])

  useEffect(() => {
    return () => {
      const projectIdValue = latestProjectIdRef.current
      const tokenValue = latestTokenRef.current
      if (!projectIdValue || !tokenValue) return

      const socket = getSocket(tokenValue)
      if (!socket) return

      socket.emit('project:leave', { projectId: projectIdValue })
      socket.emit('terminal:stop-all', { projectId: projectIdValue })
    }
  }, [])

  const emit = useCallback((eventName, payload) => {
    const socket = getSocket(token)
    if (socket) {
      socket.emit(eventName, payload)
    }
  }, [token])

  const queueFileUpdate = useCallback(
    (fileId, content) => {
      if (!fileId) return

      const previousVersion = Number(latestLocalEditVersionRef.current.get(fileId) || 0)
      // Use a monotonic clock-based version so reconnects do not restart at 1 and get rejected as stale.
      const nowVersion = Date.now()
      const nextVersion = Math.max(nowVersion, previousVersion + 1)
      latestLocalEditVersionRef.current.set(fileId, nextVersion)

      const socket = getSocket(token)
      if (!socket) {
        reportCollabIssue('Socket unavailable while sending file update.')
        return
      }

      const shouldTrackAck = Boolean(socket.connected)

      let hasAck = false
      const ackTimeout = shouldTrackAck
        ? window.setTimeout(() => {
            if (hasAck) return
            reportCollabIssue('File update timed out waiting for server acknowledgement.', {
              projectId,
              fileId,
              clientUpdatedAt: nextVersion,
              socketConnected: socket.connected,
              socketId: socket.id || null,
            })
          }, COLLAB_ACK_TIMEOUT_MS)
        : null

      socket.emit('file:update', {
        projectId,
        fileId,
        content,
        clientUpdatedAt: nextVersion,
      }, (ack) => {
        hasAck = true
        if (ackTimeout) {
          window.clearTimeout(ackTimeout)
        }
        if (!ack || ack.ok !== false) return
        reportCollabIssue(`File update rejected: ${ack.reason || 'unknown_reason'}`, {
          projectId,
          fileId,
          clientUpdatedAt: nextVersion,
          ack,
        })
      })
    },
    [projectId, token, reportCollabIssue],
  )

  const createFile = (targetFolderPath = selectedFolderPath, fileName = '') => {
    if (!canEdit) return
    const name = String(fileName || '').trim()
    if (!name) return
    const parentPath = normalizePath(targetFolderPath || '')
    const nextPath = normalizePath(parentPath ? `${parentPath}/${name}` : name)
    emit('file:create', { projectId, path: nextPath, content: '' })
  }

  const createPracticeFile = () => {
    if (!canEdit) return
    setError('')
    setIsRenamingPracticeFile(false)
    setPracticeRenameValue('')
    setIsCreatingPracticeFile(true)
    if (practiceFileName.trim()) return

    const extensionMap = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      cpp: 'cpp',
      java: 'java',
    }
    const preferredExt = extensionMap[project?.language] || 'txt'
    setPracticeFileName(`file_${files.length + 1}.${preferredExt}`)
  }

  const cancelPracticeFileCreate = () => {
    setIsCreatingPracticeFile(false)
    setPracticeFileName('')
  }

  const startPracticeRename = () => {
    if (!canEdit || !selectedFile) return
    setError('')
    setIsCreatingPracticeFile(false)
    setPracticeFileName('')
    setIsRenamingPracticeFile(true)
    setPracticeRenameValue(selectedFile.path || selectedFile.name || '')
  }

  const cancelPracticeRename = () => {
    setIsRenamingPracticeFile(false)
    setPracticeRenameValue('')
  }

  const submitPracticeRename = () => {
    if (!canEdit || !selectedFile) return

    const name = practiceRenameValue.trim()
    if (!name) {
      setError('File name is required.')
      return
    }

    const duplicate = files.some(
      (file) =>
        file.id !== selectedFile.id &&
        normalizePath(file.path || file.name).toLowerCase() === normalizePath(name).toLowerCase(),
    )
    if (duplicate) {
      setError('A file with this name already exists.')
      return
    }

    renameFile(selectedFile.id, name)
    setError('')
    setIsRenamingPracticeFile(false)
    setPracticeRenameValue('')
  }

  const submitPracticeFileCreate = () => {
    if (!canEdit) return

    const name = practiceFileName.trim()
    if (!name) {
      setError('File name is required.')
      return
    }

    const nextPath = normalizePath(name)
    if (project?.projectType === 'practice' && !runtimeMatchesPracticeLanguage(project?.language, nextPath)) {
      setError(`This DSA project only supports ${String(project?.language || '').toUpperCase()} files.`)
      return
    }

    const duplicate = files.some((file) => normalizePath(file.path || file.name).toLowerCase() === nextPath.toLowerCase())
    if (duplicate) {
      setError('A file with this name already exists.')
      return
    }

    createFile('', name)
    setPendingPracticeSelectPath(normalizePath(name))
    setError('')
    setIsCreatingPracticeFile(false)
    setPracticeFileName('')
  }

  const renameFile = (fileId, newPathValue) => {
    if (!canEdit || !fileId) return
    const newPath = normalizePath(newPathValue || '')
    if (!newPath) return

    if (project?.projectType === 'practice' && !runtimeMatchesPracticeLanguage(project?.language, newPath)) {
      setError(`This DSA project only supports ${String(project?.language || '').toUpperCase()} files.`)
      return
    }

    const file = files.find((item) => item.id === fileId)
    if (file && normalizePath(file.path) === newPath) return

    emit('file:rename', { projectId, fileId, newPath })
  }

  const deleteFile = (fileId) => {
    if (!canEdit) return
    emit('file:delete', { projectId, fileId })
  }

  const createFolder = (targetFolderPath = selectedFolderPath, folderName = '') => {
    if (!canEdit) return
    const name = String(folderName || '').trim()
    if (!name) return
    const parentPath = normalizePath(targetFolderPath || '')
    const nextFolderPath = normalizePath(parentPath ? `${parentPath}/${name}` : name)
    emit('folder:create', { projectId, folderPath: nextFolderPath })
  }

  const uploadAssetFile = async (targetFolderPath = selectedFolderPath, file) => {
    if (!canEdit || !file) return
    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported.')
      return
    }

    setError('')
    setIsUploadingAsset(true)

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('Failed to read selected image.'))
        reader.readAsDataURL(file)
      })

      const response = await apiRequest(
        `/projects/${projectId}/files/upload-image`,
        {
          method: 'POST',
          body: JSON.stringify({
            targetFolderPath: normalizePath(targetFolderPath || ''),
            fileName: file.name,
            dataUrl,
          }),
        },
        getAuthToken,
      )

      if (response?.file?.id) {
        setSelectedFileId(response.file.id)
      }
    } catch (uploadError) {
      setError(uploadError.message || 'Failed to upload image.')
    } finally {
      setIsUploadingAsset(false)
    }
  }

  const renameFolder = (folderPath, nextFolderPathValue) => {
    if (!canEdit || !folderPath) return
    const nextFolderPath = normalizePath(nextFolderPathValue || '')
    if (!nextFolderPath) return
    if (normalizePath(folderPath) === nextFolderPath) return

    emit('folder:rename', {
      projectId,
      oldPath: folderPath,
      newPath: nextFolderPath,
    })
  }

  const deleteFolder = (folderPath) => {
    if (!canEdit) return
    emit('folder:delete', { projectId, folderPath })
  }

  const onEditorChange = (value) => {
    if (!selectedFile || !canEdit) return

    const nextContent = value ?? ''
    if (nextContent === String(selectedFile.content ?? '')) return

    const localEditAt = Date.now()
    const localUpdatedAt = new Date(localEditAt).toISOString()
    latestLocalEditAtRef.current.set(selectedFile.id, localEditAt)
    typingGuardUntilRef.current = Date.now() + 120
    setFiles((prev) =>
      prev.map((file) =>
        file.id === selectedFile.id
          ? {
              ...file,
              content: nextContent,
              updatedAt: localUpdatedAt,
            }
          : file,
      ),
    )
    queueFileUpdate(selectedFile.id, nextContent)
    scheduleGhostSuggestion()
  }

  const onSendChat = (event) => {
    event.preventDefault()
    const message = chatInput.trim()
    if (!message) return

    const clientMessageId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    setChat((prev) => [
      ...prev,
      {
        id: clientMessageId,
        clientMessageId,
        message,
        userId: user?.id || 'me',
        userName: user?.name || 'You',
        createdAt: new Date().toISOString(),
      },
    ])

    const socket = getSocket(token)
    if (!socket) {
      reportCollabIssue('Socket unavailable while sending chat message.')
      return
    }

    const shouldTrackAck = Boolean(socket.connected)

    let hasAck = false
    const ackTimeout = shouldTrackAck
      ? window.setTimeout(() => {
          if (hasAck) return
          reportCollabIssue('Chat send timed out waiting for server acknowledgement.', {
            projectId,
            clientMessageId,
            socketConnected: socket.connected,
            socketId: socket.id || null,
          })
        }, COLLAB_ACK_TIMEOUT_MS)
      : null

    socket.emit('chat:send', {
      projectId,
      message,
      clientMessageId,
      userName: user?.name || '',
    }, (ack) => {
      hasAck = true
      if (ackTimeout) {
        window.clearTimeout(ackTimeout)
      }
      if (!ack || ack.ok !== false) return
      reportCollabIssue(`Chat send rejected: ${ack.reason || 'unknown_reason'}`, {
        projectId,
        clientMessageId,
        ack,
      })
    })
    setChatInput('')
  }

  const createInvite = async () => {
    try {
      const data = await apiRequest(
        `/projects/${projectId}/invite`,
        {
          method: 'POST',
          body: JSON.stringify({ role: inviteRole, actorName: user?.name || '' }),
        },
        getAuthToken,
      )
      setInviteCode(data.code)
      setInviteCopied(false)
      setError('')
    } catch (inviteError) {
      setError(inviteError.message)
    }
  }

  const removeMemberAccess = async (member) => {
    if (!member?.userId || removingMemberId) return
    const confirmed = window.confirm(`Remove ${member.userName || 'this user'} from this project?`)
    if (!confirmed) return

    setRemovingMemberId(member.userId)
    setError('')
    try {
      await apiRequest(`/projects/${projectId}/members/${member.userId}`, { method: 'DELETE' }, getAuthToken)
      setMembers((prev) => prev.filter((entry) => entry.userId !== member.userId))
    } catch (removeError) {
      setError(removeError.message || 'Failed to remove access')
    } finally {
      setRemovingMemberId('')
    }
  }

  const copyInviteCode = async () => {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setInviteCopied(true)
      setError('')
    } catch (copyError) {
      void copyError
      setError('Unable to copy invite code')
      setInviteCopied(false)
    }
  }

  const toggleSharedTerminal = (enabled) => {
    if (!isOwner) return
    emit('project:terminal-sharing:update', { projectId, enabled })
    setProject((prev) => (prev ? { ...prev, sharedTerminalEnabled: enabled } : prev))
  }

  const onSharedTerminalCheckboxChange = (enabled) => {
    if (!isOwner) return

    const currentlyEnabled = Boolean(project?.sharedTerminalEnabled)
    if (enabled && !currentlyEnabled) {
      setShowTerminalShareConfirm(true)
      return
    }

    toggleSharedTerminal(enabled)
  }

  const confirmSharedTerminalEnable = () => {
    setShowTerminalShareConfirm(false)
    toggleSharedTerminal(true)
  }

  const cancelSharedTerminalEnable = () => {
    setShowTerminalShareConfirm(false)
  }

  const handleRunClick = async () => {
    if (!selectedFile) {
      setError('No file selected.')
      return
    }

    const selectedPath = normalizePath(selectedFile.path || selectedFile.name)
    if (!isRunnablePath(selectedPath)) {
      setError('Selected file is not runnable. Use .js, .py, .cpp, .java, or .ts')
      return
    }

    if (isPracticeMode && !runtimeMatchesPracticeLanguage(project?.language, selectedPath)) {
      setError(`This DSA project is locked to ${String(project?.language || '').toUpperCase()} files only.`)
      return
    }

    setError('')
    setIsRunning(true)
    setRunStatus('queued')
    setConsoleOutput('')
    setRunResult(null)

    let sourceCode = selectedFile.content || ''
    if (!sourceCode && selectedFile.blobUrl) {
      try {
        const data = await apiRequest(`/projects/${projectId}/files/${selectedFile.id}/content`, {}, getAuthToken)
        sourceCode = data.content || ''
        setFiles((prev) =>
          prev.map((file) => (file.id === selectedFile.id ? { ...file, content: sourceCode } : file)),
        )
      } catch (loadBeforeRunError) {
        void loadBeforeRunError
        setError('Failed to load file content before run.')
        setIsRunning(false)
        return
      }
    }

    try {
      const runResponse = await apiRequest(
        `/projects/${projectId}/run`,
        {
          method: 'POST',
          body: JSON.stringify({
            filePath: selectedPath,
                stdin: practiceStdin,
          }),
        },
        getAuthToken,
      )

      if (!runResponse?.queued) {
        const stdout = runResponse?.stdout || ''
        const stderr = runResponse?.stderr || ''
        const output = [stdout, stderr].filter(Boolean).join('\n')
        setRunResult(runResponse)
        setConsoleOutput(output || '(no output)')
        setRunStatus(runResponse?.ok ? 'completed' : 'failed')
        setIsRunning(false)
        return
      }

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const maxPolls = 120
      let lastStatus = 'queued'

      for (let pollCount = 0; pollCount < maxPolls; pollCount += 1) {
        await sleep(1000)
        let jobResponse = null
        try {
          jobResponse = await apiRequest(`/executions/jobs/${runResponse.jobId}`, {}, getAuthToken)
        } catch (pollError) {
          if (pollCount < maxPolls - 1) {
            continue
          }
          throw pollError
        }
        const job = jobResponse?.job
        if (!job) continue

        if (job.status === 'queued' || job.status === 'running') {
          if (job.status !== lastStatus || pollCount === 0) {
            lastStatus = job.status
            setRunStatus(job.status)
          }
          continue
        }

        const result = job.result || {}
        const stdout = result.stdout || ''
        const stderr = result.stderr || job.errorText || ''
        const output = [stdout, stderr].filter(Boolean).join('\n')

        setRunResult(result)
        setConsoleOutput(output || '(no output)')
        setRunStatus(job.status === 'completed' ? 'completed' : 'failed')
        setIsRunning(false)
        return
      }

      setError('Execution timed out while waiting for job completion.')
      setConsoleOutput('Execution polling timed out.')
      setRunStatus('failed')
      setIsRunning(false)
    } catch (runError) {
      setError(runError.message || 'Execution error')
      setConsoleOutput(`Execution error: ${runError.message || 'Unknown error'}`)
      setRunStatus('failed')
      setIsRunning(false)
    }
  }

  const handleConsoleInput = (input) => {
    const socket = getSocket(token)
    if (socket) {
      socket.emit('code:input', { input })
    }
  }

  const handleCursorChange = (event) => {
    if (!selectedFile || !canEdit) return

    const lastLocalEditAt = Number(latestLocalEditAtRef.current.get(selectedFile.id) || 0)
    const isTyping = Date.now() - lastLocalEditAt <= TYPING_SIGNAL_WINDOW_MS
    if (!isTyping) return

    emit('cursor:update', {
      projectId,
      fileId: selectedFile.id,
      position: {
        lineNumber: event.position?.lineNumber,
        column: event.position?.column,
      },
      isTyping,
    })
  }

  const isPracticeMode = project?.projectType === 'practice'
  const isWebVanillaTemplate = project?.templateId === 'web-vanilla'
  const selectedFilePath = normalizePath(selectedFile?.path || selectedFile?.name || '')
  const selectedFileRunnable = Boolean(
    selectedFilePath &&
      isRunnablePath(selectedFilePath) &&
      (!isPracticeMode || runtimeMatchesPracticeLanguage(project?.language, selectedFilePath)),
  )

  const templateDisplayName = useMemo(() => {
    const templateId = String(project?.templateId || '').trim()
    if (!templateId) return 'Custom'

    const template = (templateCatalog || []).find((entry) => entry.id === templateId)
    const fallbackName = templateId
      .split('-')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')

    if (!template) return fallbackName

    const baseName = template.label || fallbackName
    const variants = Array.isArray(template.variants) ? template.variants : []
    if (!variants.length) return baseName

    const explicitVariantId = String(project?.templateVariantId || '').trim()
    const byId = explicitVariantId ? variants.find((variant) => variant.id === explicitVariantId) : null
    const byLanguage = variants.find(
      (variant) =>
        String(variant.defaultLanguage || '').trim().toLowerCase() ===
        String(project?.language || '').trim().toLowerCase(),
    )
    const fallbackVariant =
      variants.find((variant) => variant.id === template.defaultVariantId) || variants[0]
    const selectedVariant = byId || byLanguage || fallbackVariant

    return selectedVariant ? `${baseName} (${selectedVariant.label})` : baseName
  }, [project?.templateId, project?.templateVariantId, project?.language, templateCatalog])

  const visibleRemoteCursors = Object.entries(remoteCursors).filter(
    ([remoteUserId, value]) =>
      value.fileId === selectedFile?.id && String(remoteUserId || '') !== String(user?.id || ''),
  )

  const activeTypingUsers = useMemo(() => {
    const now = Date.now()

    return Object.entries(remoteCursors)
      .map(([remoteUserId, value]) => {
        const fileName = files.find((file) => file.id === value.fileId)?.name || 'Unknown file'
        return {
          userId: remoteUserId,
          userName: String(value.userName || 'User').trim() || 'User',
          fileId: value.fileId,
          fileName,
          avatarUrl: String(value.avatarUrl || '').trim(),
          color: String(value.color || pickCursorColor(remoteUserId)),
          lastActiveAt: Number(value.lastActiveAt || 0),
          position: value.position || null,
          isTyping: Boolean(value.isTyping),
        }
      })
      .filter(
        (entry) =>
          String(entry.userId || '') !== String(user?.id || '') &&
          entry.isTyping &&
          now - entry.lastActiveAt <= TYPING_ACTIVE_WINDOW_MS,
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }, [remoteCursors, files, user?.id])

  useEffect(() => {
    if (activeTypingUsers.length === 0) return undefined

    const timerId = window.setInterval(() => {
      const cutoff = Date.now() - TYPING_ACTIVE_WINDOW_MS
      setRemoteCursors((prev) => {
        let changed = false
        const next = {}

        for (const [remoteUserId, entry] of Object.entries(prev)) {
          if (Number(entry?.lastActiveAt || 0) < cutoff) {
            changed = true
            continue
          }
          next[remoteUserId] = entry
        }

        return changed ? next : prev
      })
    }, 1200)

    return () => {
      window.clearInterval(timerId)
    }
  }, [activeTypingUsers.length])

  const handleOpenLivePreview = async () => {
    if (!projectId || !isWebVanillaTemplate) return

    const previewTab = window.open('about:blank', '_blank')
    if (!previewTab) {
      setError('Popup blocked. Allow popups for this site and try again.')
      return
    }

    setError('')
    setIsOpeningLivePreview(true)

    try {
      const payload = await apiRequest(
        `/projects/${projectId}/live-session`,
        {
          method: 'POST',
        },
        getAuthToken,
      )

      const liveUrl = String(payload?.url || '').trim()
      if (!liveUrl) {
        throw new Error('Failed to start live preview')
      }

      previewTab.location.href = liveUrl
      previewTab.focus()
    } catch (liveError) {
      try {
        previewTab.close()
      } catch (closeError) {
        void closeError
      }
      setError(liveError.message || 'Failed to open live preview')
    } finally {
      setIsOpeningLivePreview(false)
    }
  }

  if (isProjectLoading && !project) {
    return (
      <section className="project-page project-mode">
        <p className="role-note">Loading project...</p>
      </section>
    )
  }

  // Practice/DSA Mode - Simplified UI
  if (isPracticeMode) {
    return (
      <section className="project-page practice-mode">
        <header className="practice-header">
          <div className="practice-header-left">
            <h2>{project?.name ?? 'Practice Project'}</h2>
            <span className="role-note">Practice Mode</span>
            <span className="language-badge">
              {(project?.language || 'JavaScript').toUpperCase()}
            </span>
          </div>
          <div className="practice-header-actions">
            <button 
              type="button" 
              className="run-btn"
              onClick={handleRunClick} 
              disabled={isRunning || !selectedFileRunnable}
            >
              {isRunning ? '● Running...' : '▶ Run Code'}
            </button>
            {isWebVanillaTemplate && (
              <button type="button" onClick={handleOpenLivePreview} disabled={isOpeningLivePreview}>
                {isOpeningLivePreview ? 'Opening...' : <><Globe size={16} aria-hidden="true" /> Live Preview</>}
              </button>
            )}
            <button type="button" onClick={() => navigate('/dashboard')}>
              ← Dashboard
            </button>
          </div>
        </header>

        <div className="practice-layout">
          {/* Left Panel - Code Editor */}
          <div className="practice-editor">
            <div className="practice-editor-controls">
              <div className="file-selector practice-file-toolbar">
                <label>File:</label>
                <select value={selectedFile?.id || ''} onChange={(e) => setSelectedFileId(e.target.value)}>
                  {files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                    </option>
                  ))}
                </select>
                {canEdit && (
                  <>
                    <button onClick={createPracticeFile} type="button">
                      + New
                    </button>
                    <button
                      onClick={startPracticeRename}
                      disabled={!selectedFile}
                      type="button"
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>
            </div>

            {files.length > 1 && (
              <div className="practice-file-tabs">
                {files.map((file) => {
                  const isActive = file.id === selectedFile?.id
                  return (
                    <div key={file.id} className={`practice-file-tab ${isActive ? 'active' : ''}`}>
                      <button
                        type="button"
                        className="practice-file-tab-open"
                        onClick={() => setSelectedFileId(file.id)}
                        title={file.path || file.name}
                      >
                        <span>{file.name}</span>
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="practice-file-tab-delete"
                          onClick={() => deleteFile(file.id)}
                          title={`Delete ${file.name}`}
                          aria-label={`Delete ${file.name}`}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path
                              fill="currentColor"
                              d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 1 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {canEdit && isCreatingPracticeFile && (
              <div className="practice-editor-controls practice-inline-form-row">
                <div className="file-selector practice-file-form">
                  <label>New file:</label>
                  <input
                    ref={practiceFileInputRef}
                    value={practiceFileName}
                    onChange={(event) => setPracticeFileName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitPracticeFileCreate()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelPracticeFileCreate()
                      }
                    }}
                    placeholder="example.js"
                    autoFocus
                  />
                  <button type="button" onClick={submitPracticeFileCreate}>
                    Create
                  </button>
                  <button type="button" onClick={cancelPracticeFileCreate}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {canEdit && isRenamingPracticeFile && (
              <div className="practice-editor-controls practice-inline-form-row">
                <div className="file-selector practice-file-form">
                  <label>Rename:</label>
                  <input
                    value={practiceRenameValue}
                    onChange={(event) => setPracticeRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitPracticeRename()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelPracticeRename()
                      }
                    }}
                    placeholder="example.js"
                    autoFocus
                  />
                  <button type="button" onClick={submitPracticeRename}>
                    Save
                  </button>
                  <button type="button" onClick={cancelPracticeRename}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <Editor
              key={selectedFile?.id || 'practice-editor'}
              height="100%"
              path={selectedFile?.path || selectedFile?.name || 'main.tsx'}
              language={languageForFile(selectedFile?.name ?? '', project?.language)}
              value={selectedFile?.content ?? ''}
              onChange={onEditorChange}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
                configureMonaco(monaco)
                bindGhostEditorActions(editor, monaco)
                bindDebugHoverWidget(editor, monaco)
                validateEditorImports(editor, monaco)
                editor.onDidFocusEditorText(() => {
                  editorFocusedRef.current = true
                })
                editor.onDidBlurEditorText(() => {
                  editorFocusedRef.current = false
                  clearGhostSuggestion()
                  clearDebugHover()
                })
                editor.onDidChangeModelContent(() => {
                  scheduleGhostSuggestion()
                })
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
                readOnly: !canEdit,
                hover: { enabled: false },
                inlineSuggest: { enabled: true },
                snippetSuggestions: 'top',
                tabCompletion: 'on',
                acceptSuggestionOnEnter: 'on',
              }}
            />
          </div>

          {/* Right Panel - Console & Output */}
          <div className="practice-console">
            <div className="practice-console-header">
              <h4>Interactive Console</h4>
            </div>
            
            <div className="stdin-box">
              <label htmlFor="practice-stdin">STDIN</label>
              <textarea
                id="practice-stdin"
                value={practiceStdin}
                onChange={(event) => setPracticeStdin(event.target.value)}
                placeholder="Input for the program (Optional)"
                spellCheck={false}
              />
            </div>
            
            {error && <p className="error-text">{error}</p>}
            
            <div className="practice-output-section">
              <div className="practice-output-header">
                <h5>Output</h5>
              </div>
              <InteractiveConsole
                isRunning={isRunning}
                runStatus={runStatus}
                onInput={handleConsoleInput}
                output={consoleOutput}
                projectId={projectId}
                token={token}
                filePath={selectedFilePath}
              />
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="project-page project-mode">
        <aside className="panel file-panel">
        <div className="panel-head">
          <h2>{project?.name ?? 'Project'}</h2>
          <button type="button" className="back-button" onClick={() => navigate('/dashboard')}>
            ← Back
          </button>
        </div>
        <p className="role-note">Role: {project?.role ?? '...'}</p>
        {!canEdit && <p className="role-note">Viewer mode: read-only access</p>}

        <FileTree
          files={files}
          folders={folders}
          projectName={project?.name || 'Project'}
          currentFile={selectedFile}
          selectedFolderPath={selectedFolderPath}
          onFolderSelect={setSelectedFolderPath}
          onFileSelect={(file) => setSelectedFileId(file?.id ?? null)}
          onFileCreate={createFile}
          onFolderCreate={createFolder}
          onFileRename={renameFile}
          onFolderRename={renameFolder}
          onFileDelete={deleteFile}
          onFolderDelete={deleteFolder}
          onAssetUpload={uploadAssetFile}
          canEdit={canEdit}
        />
      </aside>

      <div className="editor-panel">
        {/* Template Bar - Above Editor */}
        <div className="template-bar">
          <span>{templateDisplayName}</span>
          <div className="template-bar-side">
            <div className="typing-presence">
              {activeTypingUsers.length > 0 && (
                <div className="typing-presence-chips">
                  {activeTypingUsers.slice(0, 4).map((entry) => (
                    <div key={entry.userId} className="typing-chip" style={{ borderColor: entry.color }}>
                      <img
                        src={entry.avatarUrl || DEFAULT_AVATAR_PATH}
                        alt={`${entry.userName} avatar`}
                        onError={(event) => {
                          event.currentTarget.src = DEFAULT_AVATAR_PATH
                        }}
                      />
                      <span>{`${entry.userName} is typing in ${entry.fileName}`}</span>
                    </div>
                  ))}
                  {activeTypingUsers.length > 4 && (
                    <div className="typing-chip typing-chip-more">+{activeTypingUsers.length - 4}</div>
                  )}
                </div>
              )}
            </div>
            {isWebVanillaTemplate && (
              <div className="run-controls">
                <button type="button" onClick={handleOpenLivePreview} disabled={isOpeningLivePreview}>
                  {isOpeningLivePreview ? 'Opening...' : <><Globe size={16} aria-hidden="true" /> Live</>}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="editor-workspace">
          {selectedFileIsImage ? (
            <div className="asset-preview-wrap">
              <p className="role-note">Image preview (read-only in editor)</p>
              {selectedFilePreviewSrc ? (
                <img className="asset-preview-image" src={selectedFilePreviewSrc} alt={selectedFile?.name || 'asset'} />
              ) : (
                <p className="role-note">Image URL not available.</p>
              )}
            </div>
          ) : (
            <Editor
              key={selectedFile?.id || 'project-editor'}
              height="100%"
              path={selectedFile?.path || selectedFile?.name || 'main.tsx'}
              language={languageForFile(selectedFile?.name ?? '', project?.language)}
              value={selectedFile?.content ?? ''}
              onChange={onEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
                readOnly: !canEdit,
                hover: { enabled: false },
                inlineSuggest: { enabled: true },
                snippetSuggestions: 'top',
                tabCompletion: 'on',
                acceptSuggestionOnEnter: 'on',
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
                configureMonaco(monaco)
                bindGhostEditorActions(editor, monaco)
                bindDebugHoverWidget(editor, monaco)
                validateEditorImports(editor, monaco)
                editor.onDidFocusEditorText(() => {
                  editorFocusedRef.current = true
                })
                editor.onDidBlurEditorText(() => {
                  editorFocusedRef.current = false
                  clearGhostSuggestion()
                  clearDebugHover()
                })
                editor.onDidChangeCursorPosition((event) => {
                  handleCursorChange(event)
                  scheduleGhostSuggestion()
                })
                editor.onDidChangeModelContent(() => {
                  scheduleGhostSuggestion()
                })
              }}
            />
          )}
        </div>

        {visibleRemoteCursors.length > 0 && (
          <div className="cursor-strip">
            {visibleRemoteCursors.map(([id, value]) => (
              <span key={id}>
                {value.userName} at {value.position?.lineNumber}:{value.position?.column}
              </span>
            ))}
          </div>
        )}

        <Terminal
          projectId={projectId}
          projectName={project?.name || ''}
          token={token}
          userId={user?.id || ''}
          ownerId={project?.ownerId || ''}
          sharedTerminalEnabled={Boolean(project?.sharedTerminalEnabled)}
          isOwner={Boolean(isOwner)}
          canEdit={Boolean(canEdit)}
        />

        {isUploadingAsset && <p className="role-note">Uploading image...</p>}
        {error && <p className="error-text">{error}</p>}
      </div>

      <aside className="panel chat-panel">
        {/* Voice Channel Section */}
        <div className="voice-channel-section">
          <VoiceChannelPanel projectId={projectId} getAuthToken={getAuthToken} />
        </div>

        {/* Invite Section */}
        {isOwner && (
          <div className="invite-section">
            <h4>Invite Members</h4>
            
            <label className="shared-terminal-toggle">
              <input
                type="checkbox"
                checked={Boolean(project?.sharedTerminalEnabled)}
                onChange={(event) => onSharedTerminalCheckboxChange(event.target.checked)}
              />
              <span>Share terminal with collaborators</span>
            </label>

            <div className="invite-role-options">
              <label className={`invite-role-checkbox ${inviteRole === 'collaborator' ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={inviteRole === 'collaborator'}
                  onChange={() => setInviteRole('collaborator')}
                />
                <span>Collaborator</span>
              </label>
              <label className={`invite-role-checkbox ${inviteRole === 'viewer' ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={inviteRole === 'viewer'}
                  onChange={() => setInviteRole('viewer')}
                />
                <span>Viewer</span>
              </label>
            </div>

            <div className="invite-actions">
              <button type="button" className="generate-btn" onClick={createInvite}>
                Generate Invite Code
              </button>
            </div>

            {inviteCode && (
              <div className="invite-code-display">
                <code>{inviteCode}</code>
                <button type="button" className="copy-btn" onClick={copyInviteCode}>
                  {inviteCopied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )}

            <button 
              type="button" 
              className="manage-members-btn"
              onClick={() => setShowMembersPanel((prev) => !prev)}
            >
              {showMembersPanel ? '▼ Hide Members' : '▶ Manage Members'}
            </button>

            {showMembersPanel && (
              <div className="members-panel">
                <h5>Collaborators & Viewers</h5>
                {membersLoading ? (
                  <p className="role-note">Loading members...</p>
                ) : members.length === 0 ? (
                  <p className="role-note">No members invited yet.</p>
                ) : (
                  <div className="members-list">
                    {members.map((member) => (
                      <div key={member.userId} className="member-item">
                        <div className="member-info">
                          <strong>{member.userName || member.email || 'Unknown'}</strong>
                          <small>
                            <span className={`member-status ${member.isOnline ? 'online' : 'offline'}`}>
                              {member.isOnline ? 'Online' : 'Offline'}
                            </span>
                            {' • '}{member.role}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="member-remove-btn"
                          onClick={() => removeMemberAccess(member)}
                          disabled={Boolean(removingMemberId)}
                        >
                          {removingMemberId === member.userId ? '...' : '✕'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat Section */}
        <div className="chat-section">
          <div className="chat-head-row">
            <h3>Project Chat</h3>
            <input
              className="chat-search-input"
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              placeholder="Search..."
            />
          </div>
          <div className="chat-messages-container">
            {filteredChat.map((message) => (
              <div key={message.id} className={`chat-item ${message.userId === user?.id ? 'self' : ''}`}>
                <strong>{message.userName || (message.userId === user?.id ? 'You' : 'User')}</strong>
                <p>{message.message}</p>
                <small>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</small>
              </div>
            ))}
            {filteredChat.length === 0 && <p className="role-note">No matching chats found.</p>}
          </div>

          <form onSubmit={onSendChat} className="chat-form">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a message..."
            />
            <button type="submit">Send</button>
          </form>
        </div>

        {/* Activity Feed Section */}
        <div className="activity-section">
          <h3>Activity Feed</h3>
          <div className="activity-feed">
            {activities.length === 0 && <p className="role-note">No recent activity yet.</p>}
            {activities.map((entry) => (
              <div key={entry.id} className="activity-item">
                <strong>{entry.userId === user?.id ? user?.name || entry.userName || 'You' : entry.userName || 'Unknown'}</strong>
                <p>{describeActivity(entry)}</p>
                <small>{new Date(entry.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
        </aside>
      </section>

      {/* AI Chatbot Popup */}
      <AIChatPopup 
        projectId={projectId}
        getAuthToken={getAuthToken}
        canUseAI={canUseAiAssistant}
        selectedFile={selectedFile}
        files={files}
        onSendingStateChange={setIsAiChatGenerating}
      />

      {showTerminalShareConfirm && (
        <div className="tree-confirm-backdrop" onClick={cancelSharedTerminalEnable}>
          <div className="tree-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>Are you sure you want to share the terminal with collaborators?</p>
            <div className="tree-confirm-actions">
              <button type="button" className="confirm-yes" onClick={confirmSharedTerminalEnable}>
                Yes
              </button>
              <button type="button" className="confirm-cancel" onClick={cancelSharedTerminalEnable}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ProjectPage
