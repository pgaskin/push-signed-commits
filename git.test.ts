import { suite, describe, it } from 'node:test'
import { equal } from 'node:assert'
import * as git from './git.ts'

suite('git', () => {
    describe('splitCommitMessage', () => {
        const test = (tc: {
            what: string,
            message: string,
            subject: string,
            body: string,
        }) => {
            it(tc.what, () => {
                const {subject, body} = git.splitCommitMessage(tc.message)
                equal(subject, tc.subject, 'subject')
                equal(body, tc.body, 'body')
            })
        }
        test({
            what:    'empty',
            message: '',
            subject: '',
            body:    '',
        })
        test({
            what:    'subject only',
            message: 'subject',
            subject: 'subject',
            body:    '',
        })
        test({
            what:    'subject and body',
            message: 'subject\n\nbody',
            subject: 'subject',
            body:    'body',
        })
        test({
            what:    'two-line subject and body',
            message: 'subject\nsubject2\n\nbody\nbody2',
            subject: 'subject\nsubject2',
            body:    'body\nbody2',
        })
        test({
            what:    'three-line subject and body',
            message: 'subject\nsubject2\nsubject3\n\nbody\nbody2\nbody3',
            subject: 'subject\nsubject2\nsubject3',
            body:    'body\nbody2\nbody3',
        })
        test({
            what:    'three-line subject and body with insignificant newlines',
            message: '\n\nsubject\nsubject2\nsubject3\n\n\n\nbody\nbody2\nbody3\n\n',
            subject: 'subject\nsubject2\nsubject3',
            body:    'body\nbody2\nbody3',
        })
        test({
            what:    'three-line subject and body with insignificant newlines and whitespace',
            message: '  \t \n   \nsubject\nsubject2\nsubject3\n \f  \n  \v \n\nbody\nbody2\nbody3\n \r  \n',
            subject: 'subject\nsubject2\nsubject3',
            body:    'body\nbody2\nbody3',
        })
        test({
            what:    'three-line subject and body with insignificant newlines and whitespace, and significant whitespace',
            message: '  \t \n   \nsubject\n   subject2\nsubject3\n \f  \n  \v \n\nbody\n  body2\nbody3\n \r  \n',
            subject: 'subject\n   subject2\nsubject3',
            body:    'body\n  body2\nbody3',
        })
    })
    describe('trimBlankLinesStart', () => {
        const test = (tc: [
            string, // what
            string, // in
            string, // out
        ]) => {
            it(tc[0], () => {
                const out = git.__test.trimBlankLinesStart(tc[1])
                equal(out, tc[2])
            })
            test(['empty', '', ''])
            test(['one newline', '\n', ''])
            test(['all newline', '\n\n\n', ''])
            test(['no newline', 'test', 'test'])
            test(['no newline all spaces', '   ', '   '])
            test(['no blank lines', 'test\ntest', 'test\ntest'])
            test(['leading and trailing newline', '\ntest\ntest\n', 'test\ntest\n'])
            test(['leading and trailing newlines', '\n\ntest\ntest\n\n', 'test\ntest\n\n'])
            test(['ascii whitespace', '\n \t\r\v \ntest\n \t\r\v \n', 'test\n \t\r\v \n'])
            test(['blank lines in middle', 'test\n\n\ntest', 'test\n\n\ntest'])
            test(['blank line at start', '\ntest\n', 'test\n'])
            test(['blank line in middle', 'test\n\ntest\n', 'test\n\ntest\n'])
            test(['blank line at end', 'test\n\n', 'test\n\n'])
            test(['blank line with ascii whitespace', 'test\n \t\r\v \ntest', 'test\n \t\r\v \ntest'])
        }
    })
    describe('trimBlankLinesEnd', () => {
        const test = (tc: [
            string, // what
            string, // in
            string, // out
        ]) => {
            it(tc[0], () => {
                const out = git.__test.trimBlankLinesEnd(tc[1])
                equal(out, tc[2])
            })
        }
        test(['empty', '', ''])
        test(['one newline', '\n', ''])
        test(['all newline', '\n\n\n', ''])
        test(['no newline', 'test', 'test'])
        test(['no newline all spaces', '   ', '   '])
        test(['no blank lines', 'test\ntest', 'test\ntest'])
        test(['leading and trailing newline', '\ntest\ntest\n', '\ntest\ntest'])
        test(['leading and trailing newlines', '\n\ntest\ntest\n\n', '\n\ntest\ntest'])
        test(['ascii whitespace', '\n \t\r\v \ntest\n \t\r\v \n', '\n \t\r\v \ntest'])
        test(['blank lines in middle', 'test\n\n\ntest', 'test\n\n\ntest'])
        test(['blank line at start', '\ntest\n', '\ntest'])
        test(['blank line in middle', 'test\n\ntest\n', 'test\n\ntest'])
        test(['blank line at end', 'test\n\n', 'test'])
        test(['blank line with ascii whitespace', 'test\n \t\r\v \ntest', 'test\n \t\r\v \ntest'])
    })
    describe('cutBlankLine', () => {
        const test = (tc: [
            string, // what
            string, // in
            string, // before
            string, // after
        ]) => {
            it(tc[0], () => {
                const [before, after] = git.__test.cutBlankLine(tc[1])
                equal(before, tc[2], 'before')
                equal(after, tc[3], 'after')
            })
        }
        test(['empty', '', '', ''])
        test(['one newline', '\n', '', ''])
        test(['all newline', '\n\n\n', '', '\n\n'])
        test(['no newline', 'test', 'test', ''])
        test(['no newline all spaces', '   ', '   ', ''])
        test(['no blank lines', 'test\ntest', 'test\ntest', ''])
        test(['leading and trailing newline', '\ntest\ntest\n', '', 'test\ntest\n'])
        test(['leading and trailing newlines', '\n\ntest\ntest\n\n', '', '\ntest\ntest\n\n'])
        test(['ascii whitespace', '\n \t\r\v \ntest\n \t\r\v \n', '', ' \t\r\v \ntest\n \t\r\v \n'])
        test(['blank lines in middle', 'test\n\n\ntest', 'test\n', '\ntest'])
        test(['blank line at start', '\ntest\n', '', 'test\n'])
        test(['blank line in middle', 'test\n\ntest\n', 'test\n', 'test\n'])
        test(['blank line at end', 'test\n\n', 'test\n', ''])
        test(['blank line with ascii whitespace', 'test\n \t\r\v \ntest', 'test\n', 'test'])
    })
})

