const DUMP_OPTIONS = { indent: 2, lineWidth: -1, noRefs: true, skipInvalid: true, quotingType: '"', noCompatMode: true };

// Rules for converting from the specified config version
const RULES = {
    1: { autoCopies: ['enabled', 'delay', 'max-player-distance-from-end-centre', 'enable-xp-drop', 'enable-decoration-orbs',
        'enable-egg-respawn', 'enable-defeat-announcement', 'enable-commands', 'xp-mode', 'xp-per-player', 'orb-count-per-player',
        'egg-position', 'defeat-announcement-message-one-participant', 'defeat-announcement-message-multiple-participants',
        'commands', 'commands-no-participants-filler'], copies: [] },
    2: { autoCopies: ['enabled', 'delay', 'max-player-distance-from-end-centre'],
        copies: [['enable-xp-drop', 'xp-drop.enabled'], ['xp-mode', 'xp-drop.mode'], ['xp-per-player', 'xp-drop.xp-per-player'],
        ['enable-decoration-orbs', 'decoration-orbs.enabled'], ['orb-count-per-player', 'decoration-orbs.orb-count-per-player'],
        ['enable-egg-respawn', 'egg-respawn.enabled'], ['egg-position.x', 'egg-respawn.position.x'],
        ['egg-position.y', 'egg-respawn.position.y'], ['egg-position.z', 'egg-respawn.position.z'],
        ['egg-position.override-y', 'egg-respawn.position.override-y'],
        ['enable-defeat-announcement', 'defeat-announcement.enabled'],
        ['defeat-announcement-message-one-participant', 'defeat-announcement.one-participant'],
        ['defeat-announcement-message-multiple-participants', 'defeat-announcement.multiple-participants'],
        ['enable-commands', 'custom-commands.enabled'], ['commands', 'custom-commands.commands'],
        ['commands-no-participants-filler', 'custom-commands.no-participants-filler']] },
    3: { autoCopies: ['enabled', 'delay', 'max-player-distance-from-end-centre', 'xp-drop', 'decoration-orbs',
    'egg-respawn', 'defeat-announcement', 'custom-commands', 'bossbar-customisation', 'dragon-respawn-cooldown'], copies: [] },
    4: { autoCopies: ['enabled', 'delay', 'max-player-distance-from-end-centre', 'xp-drop.enabled', 'decoration-orbs',
    'egg-respawn', 'defeat-announcement', 'custom-commands', 'bossbar-customisation', 'dragon-respawn-cooldown', 'statistics'],
        copies: [['xp-drop.mode', 'xp-drop.interpretation'], ['xp-drop.xp-per-player', 'xp-drop.amount']] },
};
const LATEST_VERSION = Number(Object.keys(RULES)[Object.keys(RULES).length - 1]) + 1; // Surprisingly complex

// Keys that are decimals by default (dumb jsyaml doesn't keep decimals like 1.0 after parsing)
const DEFAULT_DECIMALS = [
    'egg-respawn.chance',
    'dragon-enhancements.damage.hit-multiplier',
    'dragon-enhancements.damage.breath-multiplier',
]

const LISTS = [
    'commands',
    'custom-commands.commands',
    'bossbar-customisation.names',
]

const POTENTIAL_DUPLICATE_LASTKEYS = [
    'enabled',
    //'x', 'y', 'z',
]

async function update(sourceConfigStr, version, recursions = 0) {
    // Load sourceConfig to obj
    sourceConfigStr = sourceConfigStr.replaceAll('\r', '');
    let sourceConfigObj;
    try {
        sourceConfigObj = jsyaml.load(sourceConfigStr, 'utf8');
    } catch (e) {
        error('Error parsing old config')
        return;
    }
    if (sourceConfigObj === undefined) {
        return;
    }

    let response;
    try {
        response = await fetch(`configs/config-v${version + 1}.yml`);
    } catch (e) {
        error('Error fetching local target config')
        return;
    }
    let targetConfigStr = await response.text();
    targetConfigStr = targetConfigStr.replaceAll('\r', '');
    // Load targetConfig as obj
    let targetConfigObj = jsyaml.load(targetConfigStr, 'utf8');

    // Parse source obj values and set relevant target obj values
    let rules = RULES[version];
    let autoCopies = flattenKeys(rules.autoCopies, sourceConfigObj);
    console.log('Autocopies now: ' + JSON.stringify(autoCopies));

    let touchedKeys = [];
    for (let key of autoCopies) {
        let value = getValueAtKey(sourceConfigObj, key);
        if (Array.isArray(value)) value = jsyaml.dump(value, DUMP_OPTIONS);
        else if (value === undefined || value === null) continue;
        setValueAtKey(targetConfigObj, key, value);
        touchedKeys.push(key);
    }
    for (let [sourceKey, targetKey] of rules.copies) {
        let value = getValueAtKey(sourceConfigObj, sourceKey);
        if (Array.isArray(value)) value = jsyaml.dump(value, DUMP_OPTIONS);
        else if (value === undefined || value === null) continue;
        setValueAtKey(targetConfigObj, targetKey, value);
        touchedKeys.push(targetKey);
    }

    // Replace the placeholder values with the new target obj values and any untouched keys should be same as the targetConfig defaults
    let targetConfigDefaultsObj = jsyaml.load(targetConfigStr, 'utf8');
    for (let key of touchedKeys) {
        let defaultValue = getValueAtKey(targetConfigDefaultsObj, key);
        let needsQuotes = typeof defaultValue === 'string' && (defaultValue.includes(' ') || defaultValue.includes('-') || defaultValue == '');
        if (needsQuotes) defaultValue = `"${defaultValue}"`;
        // Unique exception for decimals
        if (DEFAULT_DECIMALS.includes(key)) defaultValue = `${defaultValue}.0`;

        // wait... why is it target and not source? OH right because the targetobj values have been set already. makes sense
        let value = getValueAtKey(targetConfigObj, key);
        if (LISTS.includes(key) && value !== null) value = '\n' + jsyaml.dump(value, DUMP_OPTIONS);
        if (needsQuotes) value = `"${value}"`;

        let toReplace;
        let keyNameToSet = key;
        if (key.includes('.')) {
            let keys = key.split('.');
            let lastKey = keys[keys.length - 1];
            let indentation = '  '.repeat(keys.length - 1);
            toReplace = `${indentation}${lastKey}: ${defaultValue}`;
            keyNameToSet = indentation + lastKey;
            if (LISTS.includes(key)) {
                if (value !== null) {
                    value = value.substring(2, value.length - 1);
                    //value = value.replace(/>-\n\s*/g, '')
                    value = value.replaceAll('\n', `"\n${indentation}`)
                    value = value.replaceAll('- ', '- "')
                    value = value.replace('"', '') + '"';
                }
                if (defaultValue === null) {
                    toReplace = `${indentation}${lastKey}:`;
                } else {
                    let def = jsyaml.dump(defaultValue, DUMP_OPTIONS);
                    def = def.replaceAll('\n', `"\n${indentation}  `).replaceAll('- ', '- "').trimEnd();
                    toReplace = `${indentation}${lastKey}:\n${indentation}  ${def}`;
                    //document.getElementById('debug').innerText = toReplace + '\n\n' + targetConfigStr;
                }
            } else if (POTENTIAL_DUPLICATE_LASTKEYS.includes(lastKey)) {
                // Presume no comments above
                // Extend toReplace to include the previous, one less indented line
                let prevKey = keys[keys.length - 2];
                let prevIndentation = '  '.repeat(keys.length - 2);
                toReplace = `${prevIndentation}${prevKey}:\n${toReplace}`;
                keyNameToSet = prevIndentation + prevKey + ':\n' + keyNameToSet;
            }
        } else {
            toReplace = `${key}: ${defaultValue}`;
            if (LISTS.includes(key)) {
                if (defaultValue === null) {
                    //toReplace = `${key}:`;
                    // this raises a significant issue with identical key names!
                    toReplace = new RegExp(`^${key}:`, 'm')
                    if (value !== null) {
                        value = value.substring(2, value.length - 1);
                        //value = value.replaceAll('\n', `\n  `)
                    }
                    console.log('MUST BE DOING THIS ! ! ! ');
                } else {
                    let def = jsyaml.dump(defaultValue);
                    def = def.substring(0, value.length - 1);
                    def = def.replaceAll('\n', `\n  `)
                    toReplace = `${key}:\n  ${def}`;
                }
            }
        }
        if (key == 'commands') console.log('COMMANDS to replace: ' + toReplace);
        console.log(key);
        if (key == 'xp-drop.enabled') console.log(`Finally setting ${key} to ${getValueAtKey(targetConfigObj, key)}`);
        if (value === false && key == 'xp-drop.enabled'){
            console.log('Value truly is false');
                value = 'false';
        }
        if (key == 'xp-drop.enabled') console.log('before:' + targetConfigStr);
        targetConfigStr = targetConfigStr.replace(toReplace, `${keyNameToSet}: ${value}`) // TODO Not gonna work for lists!
        if (key == 'xp-drop.enabled') console.log('after:' + targetConfigStr);
    }

    // temp
    //if (version == 3) console.log(sourceConfigStr);
    console.log('RECURSIONS: ' + recursions);
    console.log(targetConfigStr);
    //if (version == 1) return targetConfigStr;
    console.log('THIS ISN EVERG ETTING CALLED!');

    if (version >= LATEST_VERSION - 1) {
        return targetConfigStr;
    } else if (recursions > 20) {
        return 'Recursion limit reached (this is an error and definitely shouldn\'t have happened!)';
    } else {
        return update(targetConfigStr, version + 1, recursions + 1);
    }
}

function flattenKeys(rules, sourceConfigObj) {
    let keysToAddBack = [];
    for (let ruleKey of rules) {
        let value = getValueAtKey(sourceConfigObj, ruleKey);
        if (value === null) continue;
        if (typeof value !== 'object' || Array.isArray(value)) {
            console.log(`${ruleKey} is not an object, so adding to keysToAddBack.`);
            keysToAddBack.push(ruleKey);
            continue;
        }
        console.log(`${ruleKey} is an object, so checking for nested objects.`);
        let keysWithObjects = [ruleKey];
        let iters = 0;
        while (keysWithObjects.length > 0) {
            let kwoToRemove = [];
            for (let keyWithObj of keysWithObjects) {
                obj = getValueAtKey(sourceConfigObj, keyWithObj);
                console.log(`Working on ${keyWithObj} which has value ${JSON.stringify(obj)}.`);
                if (obj == false) {
                    console.log(`A falsey!!!! WHY`);
                }
                if (obj === null) {
                    kwoToRemove.push(keyWithObj);
                    continue;
                }
                for (let [key, val] of Object.entries(obj)) {
                    let str = keyWithObj + '.' + key;
                    console.log(`Checking ${str} with value ${val}.`);
                    if (typeof val === 'object' && !Array.isArray(val)) {
                        console.log(`${str} is an object, so adding to keysWithObjects.`);
                        if (!keysWithObjects.includes(str)) keysWithObjects.push(str);
                        continue;
                    }
                    console.log(`${str} is not an object, so adding to keysToAddBack.`);
                    if (!keysToAddBack.includes(str)) keysToAddBack.push(str);
                }
                kwoToRemove.push(keyWithObj);
            }
            for (kwo of kwoToRemove) {
                if (keysWithObjects.includes(kwo))
                    keysWithObjects = removeItemFromArr(keysWithObjects, kwo);
            }
            console.log(keysWithObjects);
            console.log(keysToAddBack);
            iters++;
            if (iters > 500) break;
        }
    }
    return keysToAddBack;
}

function getValueAtKey(obj, key) {
    let keys = key.split('.');
    let value = obj;
    for (let key of keys) {
        try {
            value = value[key];
        } catch (e) {
            error(`Error getting value at key "${key}" - key probably doesn't exist in old config (but it should)`);
            return undefined;
        }
    }
    if (key.includes('xp') && false) {
        console.log(obj);
        console.log(keys);
        console.log(`value of ${key} = ${value}`);
    }
    return value;
}

function setValueAtKey(obj, key, value) {
    let keys = key.split('.');
    let lastKey = keys.pop();
    let target = obj;
    for (let key of keys) {
        target = target[key];
    }
    console.log(`COW Setting ${key} to ${value}`);
    target[lastKey] = value;
    if (key == 'xp-drop.enabled') console.log(obj);
    if (key == 'xp-drop.enabled') console.log(target);
}

function removeItemFromArr(arr, value) {
    var index = arr.indexOf(value);
    if (index > -1) {
        arr.splice(index, 1);
    }
    return arr;
}

function detectVersion() {
    // Try and detect version in old config ('version: x' in the text)
    let version = 0;
    let sourceConfigStr = OLD_CONFIG_INPUT.value;
    let versionMatch = sourceConfigStr.match(/version: (\d+)/);
    if (versionMatch) {
        version = Number(versionMatch[1]);
    }
    let versions = Object.keys(RULES);
    if (version >= versions[0] && version <= versions[versions.length - 1]) {
        V_DROPDOWN.value = version;
    }
}

function copyNewToClipboard() {
    if (NEW_CONFIG_INPUT.value.length <= 0) return;
    navigator.clipboard.writeText(NEW_CONFIG_INPUT.value);
    COPY_BUTTON.classList.remove('golden');
}

function error(message) {
    if (message === null) message = '';
    console.log(message);
    document.getElementById('debug').innerText = message;
}

const V_DROPDOWN = document.getElementById('old-version');
for (let version of Object.keys(RULES)) {
    let option = document.createElement('option');
    option.value = version;
    option.text = `version: ${version}`;
    V_DROPDOWN.add(option);
}
V_DROPDOWN.selectedIndex = V_DROPDOWN.options.length - 1; // Assume most recent version

const OLD_CONFIG_INPUT = document.getElementById('old-config');
const NEW_CONFIG_INPUT = document.getElementById('new-config');
const COPY_BUTTON = document.getElementById('copy-button');
const CLEAR_BUTTON = document.getElementById('clear-button');

OLD_CONFIG_INPUT.addEventListener('input', async function () {
    error(null);
    if (OLD_CONFIG_INPUT.value === '') {
        CLEAR_BUTTON.click();
        return;
    }
    if (!OLD_CONFIG_INPUT.value.includes('version:') || !OLD_CONFIG_INPUT.value.includes('enabled:')) {
        error('Old config is an invalid config format (check that it has the "version" and "enabled" keys present)');
        return;
    }
    detectVersion();
    V_DROPDOWN.disabled = false;
    OLD_CONFIG_INPUT.disabled = true;
    let output;
    try {
        output = await update(OLD_CONFIG_INPUT.value, Number(V_DROPDOWN.value));
    } catch (e) {
        error('Error updating config:\n' + e.message);
    }
    OLD_CONFIG_INPUT.disabled = false;
    if (output !== OLD_CONFIG_INPUT.value && OLD_CONFIG_INPUT.value !== '' && output !== undefined) {
        COPY_BUTTON.classList.add('golden');
        NEW_CONFIG_INPUT.value = output;
    }
});

COPY_BUTTON.addEventListener('click', copyNewToClipboard);

CLEAR_BUTTON.addEventListener('click', function () {
    OLD_CONFIG_INPUT.value = '';
    NEW_CONFIG_INPUT.value = '';
    COPY_BUTTON.classList.remove('golden');
    V_DROPDOWN.disabled = true;
});

document.getElementById('latest-v').innerText = `version: ${LATEST_VERSION}`;

// Loop through all children in all config-toolbar s (seperately) and add 4px left margin to all but the first child
for (let toolbar of document.getElementsByClassName('config-toolbar')) {
    let children = toolbar.children;
    for (let i = 1; i < children.length; i++) {
        children[i].style.marginLeft = '4px';
    }
}