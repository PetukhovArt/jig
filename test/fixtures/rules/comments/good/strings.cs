var url = "http://host/a /* b */";
var path = @"C:\dir\";
var quoted = @"he said ""// hi""";
var hole = $"{(ok ? "// yes" : @"/* no */")} {{ // }}";
var verbatimHole = $@"{root}\
// still the string";
var json = $$"""
    { "url": "//{{host}}" } /* text */
    """;
var slash = '/';
var quote = '\'';
var doubleQuote = '"';
