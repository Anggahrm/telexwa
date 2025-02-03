import { readFileSync, writeFileSync } from 'fs';
import { js } from 'js-beautify';

class CaseManager {
    constructor(file) {
        this.file = file;
    }

    get(name) {
        try {
            let content = readFileSync(this.file, 'utf8');
            let regex = /case .*?:/g;
            let cases = content.match(regex);
            let targetCases = cases.filter(cas => cas.includes(name));
            if (targetCases.length > 0) {
                let start = content.indexOf(targetCases[0]);
                let end = content.indexOf('break', start);
                return content.substring(start, end + 6);
            } else {
                return null;
            }
        } catch (error) {
            console.error(`Failed to read file: ${error.message}`);
            return null;
        }
    }

    add(code) {
        try {
            let content = readFileSync(this.file, 'utf8');
            let regex = /switch\s*\([^)]+\)\s*{/;
            let switchContent = content.match(regex);
            let newCase = `${code}`;
            let updatedContent = content.replace(regex, `${switchContent}\n${newCase}`);
            writeFileSync(this.file, js(updatedContent));
            return true;
        } catch (error) {
            console.error(`Failed to add case: ${error.message}`);
            return false;
        }
    }

    delete(name) {
        try {
            let content = readFileSync(this.file, 'utf8');
            let caseToDelete = this.get(name);
            if (!caseToDelete) return false;
            let updatedContent = content.replace(caseToDelete, '');
            writeFileSync(this.file, updatedContent);
            return true;
        } catch (error) {
            console.error(`Failed to delete case: ${error.message}`);
            return false;
        }
    }

    list() {
        try {
            let data = readFileSync(this.file, "utf8");
            let casePattern = /case\s+"([^"]+)"/g;
            let matches = data.match(casePattern)?.map((match) => match.replace(/case\s+"([^"]+)"/, "$1")) || [];
            return matches;
        } catch (error) {
            console.error(`Failed to read file: ${error.message}`);
            return [];
        }
    }
}

export default CaseManager;