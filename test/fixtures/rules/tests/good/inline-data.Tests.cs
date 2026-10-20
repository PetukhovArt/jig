public class CodecTests
{
    [Theory]
    [InlineData("10", 1)]
    [InlineData("01", 2)]
    public void Writes(string order, int value) => Assert.Equal(value, Codec.Write(order));
}
