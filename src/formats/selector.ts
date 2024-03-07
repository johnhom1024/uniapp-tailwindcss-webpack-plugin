import selectorParser from 'postcss-selector-parser';
import type { ClassName, Root } from 'postcss-selector-parser';
import escapeStringRegexp from 'escape-string-regexp';
import { parse as styleParser } from 'postcss';
import type { Rule } from 'postcss';
import { Source } from 'webpack-sources';
import { Parser } from 'htmlparser2';
import MagicString from 'magic-string';

import generate from '@babel/generator';
import { parseExpression } from '@babel/parser';
import traverse from '@babel/traverse';

import { SimpleMappingChars2String } from '@/lib/dict';
import {
  tagWithEitherClassAndHoverClassRegexp,
  vueTemplateClassRegexp,
  variableRegExp,
  mainCssFileReg,
  wxmlFileReg,
} from '../lib/reg';

import { stripExpression } from '@/utils/wxml/utils';

export class SelectorTransformer {
  mappingChars2String: Record<string, string>;
  constructor({
    customMappingChars2String,
  }: {
    customMappingChars2String: Record<string, string>;
  }) {
    this.mappingChars2String = {
      ...SimpleMappingChars2String,
      // 这里是外部传入的自定义字符转换
      ...customMappingChars2String,
    };
  }

  /**
   * @description: 将className中匹配chars的值转换成对应的值
   * @param {string} className
   * @return {string}
   */
  transform(className: string) {
    Object.entries(this.mappingChars2String).forEach((item) => {
      const [k, v] = item;

      /**
       * k中特殊的字符需要经过转义，然后再生成正则表达式，例如 k = .时
       * 需要先转换成 \. 然后再给到new RegExp ，最终生成 /\./
       * 这样可以匹配 . 字符 然后替换成 微信小程序中支持的字符
       */
      const regexp = new RegExp(escapeStringRegexp(k), 'g');
      if (regexp.test(className)) {
        className = className.replaceAll(regexp, v);
      }
    });

    return className;
  }

  /**
   * @param className 不包含表达式，单纯是tailwindcss的class
   * @returns 特殊字符转换之后
   */
  transformClassName(className: string) {
    Object.entries(this.mappingChars2String).forEach((item) => {
      const [k, v] = item;

      /**
       * k中特殊的字符需要经过转义，然后再生成正则表达式，例如 k = .时
       * 需要先转换成 \. 然后再给到new RegExp ，最终生成 /\./
       * 这样可以匹配 . 字符 然后替换成 微信小程序中支持的字符
       */
      const regexp = new RegExp(escapeStringRegexp(k), 'g');
      if (regexp.test(className)) {
        className = className.replaceAll(regexp, v);
      }
    });

    return className;
  }
}

export class WechatSelectorTransformer extends SelectorTransformer {
  constructor({
    customMappingChars2String = SimpleMappingChars2String,
  }: {
    customMappingChars2String: Record<string, string>;
  }) {
    super({ customMappingChars2String });
  }

  /**
   * @description: 匹配css文件
   * @param {string} filename
   * @return {boolean}
   */
  _cssMatcher(filename: string): boolean {
    return mainCssFileReg.test(filename);
  }

  /**
   * @description: 匹配 .wxml文件
   * @param {string} filename
   * @return {*}
   */
  _wxmlMatcher(filename: string): boolean {
    return wxmlFileReg.test(filename);
  }

  /**
   * @description: 接收filename 并把匹配的文件进行处理，并把处理后的字符串放到callback中执行
   * @param {string} filename
   * @param {string} originalSource
   * @param {function} callback
   */
  traverse(
    filename: string,
    originalSource: Source,
    callback: (arg: string) => void
  ): void {
    const source = originalSource.source().toString();
    let newSource = '';
    if (this._cssMatcher(filename)) {
      newSource = this.styleHandler(source);
    } else if (this._wxmlMatcher(filename)) {
      newSource = this.wxmlHandler(source);
    }

    // 如果进行过处理，则执行callback
    if (newSource) {
      callback(newSource);
    }
  }

  styleHandler(rawSource: string): string {
    const root = styleParser(rawSource);
    root.walkRules((rule: Rule) => {
      rule.selector = this._styleTransform(rule.selector);
    });

    return root.toString();
  }

  /**
   * @description: 处理html代码中的class
   * @param {string} rawSource
   * @return {*}
   */
  wxmlHandler(rawSource: string): string {
    // 这里匹配开头的标签，例如：<view class="content">
    return rawSource.replace(tagWithEitherClassAndHoverClassRegexp, (m0) => {
      return m0.replace(vueTemplateClassRegexp, (match, className) => {
        // match 匹配的结构为 class="font-bold"
        // className的结构为 font-bold flex-[0_0_300rpx] 等
        return match.replace(className, this._wxmlTransform(className));
      });
    });
  }

  /**
   * 基于htmlparser2对html进行解析
   * @param rawSource
   */
  wxmlHandlerV2(rawSource: string): string {
    const ms = new MagicString(rawSource);
    
    const parser = new Parser({
      onattribute: (name, value, quote) => {
        if (value) {
      
          if (name === 'class' || name === 'hover-class') {
            // 获取value进行处理，把一些特殊字符转换成小程序支持的字符
            value = this._wxmlTransform(value);
          }
        }
      },
    });

    parser.write(rawSource);
    parser.end();
  }

  _styleTransform(selector: string) {
    const result = selectorParser((selector: Root) => {
      selector.walkClasses((classNode: ClassName) => {
        if (classNode.type === 'class') {
          // 这里会吞掉 \ 字符
          classNode.value = this.transform(classNode.value);
        }

        // 如果最后长度为0，则直接删掉该类
        if (classNode.value.length === 0) {
          classNode.remove();
        }
      });
    }).processSync(selector);

    return result;
  }

  _wxmlTransform(className: string): string {
    const sources = stripExpression(className);

    if (sources.length) {
      const resultArray: string[] = [];

      let p = 0;
      for (let i = 0; i < sources.length; i++) {
        const m = sources[i];
        // 转换
        resultArray.push(this.transform(className.slice(p, m.start)));

        p = m.start;

        // 匹配后值
        if (m.raw.trim().length) {
          const code = this.transformCode(m.raw);
          m.raw = `{{${code}}}`;
        } else {
          m.raw = '';
        }

        resultArray.push(m.raw);

        p = m.end;
      }

      return resultArray.filter((x) => x).join('');
    } else {
      return this.transform(className);
    }
  }

  /**
   * @description: 传入代码，解析成ast，并且转换其中的字符串字面量
   * @param {string} code
   * @return {*}
   */
  private transformCode(code: string) {
    const ast = parseExpression(code);

    traverse(ast, {
      StringLiteral: (path) => {
        path.node.value = this.transform(path.node.value);
      },
      noScope: true,
    });

    const { code: newCode } = generate(ast, {
      // 压缩，去掉空格
      minified: false,
      jsescOption: {
        quotes: 'single',
      },
    });

    return newCode;
  }
}
