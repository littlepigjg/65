import { diffLines, Change } from 'diff';
import { DiffResult, DiffLine } from '../types';

export class DiffComparer {
  static compare(sourceContent: string, targetContent: string): DiffResult {
    const changes = diffLines(sourceContent, targetContent);
    
    const lines: DiffLine[] = [];
    let additions = 0;
    let removals = 0;
    let sourceLineNumber = 1;
    let targetLineNumber = 1;
    
    for (const change of changes) {
      const changeLines = change.value.split('\n');
      
      if (changeLines[changeLines.length - 1] === '') {
        changeLines.pop();
      }
      
      for (const lineContent of changeLines) {
        if (change.added) {
          lines.push({
            type: 'added',
            content: lineContent,
            lineNumber: targetLineNumber
          });
          targetLineNumber++;
          additions++;
        } else if (change.removed) {
          lines.push({
            type: 'removed',
            content: lineContent,
            lineNumber: sourceLineNumber
          });
          sourceLineNumber++;
          removals++;
        } else {
          lines.push({
            type: 'unchanged',
            content: lineContent,
            lineNumber: sourceLineNumber
          });
          sourceLineNumber++;
          targetLineNumber++;
        }
      }
    }
    
    return {
      additions,
      removals,
      lines
    };
  }

  static mergeContents(sourceContent: string, targetContent: string, selectedLines: number[]): string {
    const changes = diffLines(sourceContent, targetContent);
    const result: string[] = [];
    
    let currentLineIndex = 0;
    
    for (const change of changes) {
      const changeLines = change.value.split('\n');
      
      if (changeLines[changeLines.length - 1] === '') {
        changeLines.pop();
      }
      
      for (const lineContent of changeLines) {
        if (!change.added && !change.removed) {
          result.push(lineContent);
        } else {
          if (selectedLines.includes(currentLineIndex)) {
            if (change.added) {
              result.push(lineContent);
            }
          } else {
            if (change.removed) {
              result.push(lineContent);
            }
          }
        }
        currentLineIndex++;
      }
    }
    
    return result.join('\n');
  }

  static getSideBySideDiff(sourceContent: string, targetContent: string): {
    left: { content: string; type: string; lineNumber: number }[];
    right: { content: string; type: string; lineNumber: number }[];
  } {
    const changes = diffLines(sourceContent, targetContent);
    
    const left: { content: string; type: string; lineNumber: number }[] = [];
    const right: { content: string; type: string; lineNumber: number }[] = [];
    
    let leftLine = 1;
    let rightLine = 1;
    
    for (const change of changes) {
      const changeLines = change.value.split('\n');
      
      if (changeLines[changeLines.length - 1] === '') {
        changeLines.pop();
      }
      
      for (const lineContent of changeLines) {
        if (change.added) {
          left.push({ content: '', type: 'empty', lineNumber: 0 });
          right.push({ content: lineContent, type: 'added', lineNumber: rightLine });
          rightLine++;
        } else if (change.removed) {
          left.push({ content: lineContent, type: 'removed', lineNumber: leftLine });
          right.push({ content: '', type: 'empty', lineNumber: 0 });
          leftLine++;
        } else {
          left.push({ content: lineContent, type: 'unchanged', lineNumber: leftLine });
          right.push({ content: lineContent, type: 'unchanged', lineNumber: rightLine });
          leftLine++;
          rightLine++;
        }
      }
    }
    
    return { left, right };
  }
}
