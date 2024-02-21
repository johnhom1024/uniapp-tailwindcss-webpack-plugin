import { describe, expect, it } from 'vitest';
import { WechatSelectorTransformer } from '../src/formats/selector';
import { SimpleMappingChars2String } from '@/lib/dict';
import { getTwCss } from '@test/helpers/getTwCss';

describe('测试selector转换', () => {
  const selectorTransformer = new WechatSelectorTransformer({
    customMappingChars2String: SimpleMappingChars2String,
  });

  it('测试getTwCss', async () => {
    const res = await getTwCss('<view class="h-10 w-10 h-[10rpx]"></view>')
    expect(res.css).toBe('h-10 w-10 bg-rgba25525425305')
  })

  it('测试wxml转换"["或者"]"', () => {
    const wxmlString = `<div class="w-[20rpx]"></div>`;

    expect(selectorTransformer.wxmlHandler(wxmlString)).toBe(
      '<div class="w-_20rpx_"></div>'
    );
  });

  it('测试wxml转换/', () => {
    const wxmlString = `<view class="w-2/3"></view>`;

    expect(selectorTransformer.wxmlHandler(wxmlString)).toBe(
      '<view class="w-2s3"></view>'
    );
  });

  it('测试wxss转换 .hover\\:via-blue-50:hover', () => {
    // \ 这个字符串会被selectorParser吞掉，所以无需转换
    const wxssString = `.hover\\:via-blue-50:hover {
      background-color: blue;
    }`;
    console.log(wxssString);
    expect(selectorTransformer.styleHandler(wxssString))
      .toBe(`.hovercvia-blue-50:hover {
      background-color: blue;
    }`);
  });
});
